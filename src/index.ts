import { createJupiterApiClient, SwapRequest, Instruction, DefaultApi,
    QuoteGetRequest,QuoteGetSwapModeEnum,
    QuoteResponseFromJSON,
    QuoteResponse
 } from '@jup-ag/api';
import { LAMPORTS_PER_SOL, Keypair, Connection,Transaction,
    SystemProgram, PublicKey, TransactionInstruction,ComputeBudgetProgram,
    TransactionMessage, VersionedTransaction,AddressLookupTableAccount,
    clusterApiUrl
 } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import 'dotenv/config';
import bs58 from 'bs58';
import axios from 'axios';
import { wait, instructionFormat, getQuote, sendTxToBundle,sendTxToJito,getPairs,
    batchSendTxToBundle,batchSendTxToJito,batchSendTxToRpcs, 
    sendTxToRpc} from './lib.js';
import { config,trade_pairs,pair,batchBundleApi } from './config.js';
import WebSocket from 'ws';
import os from 'os';
import fs from 'fs';

// 导入环境变量
// const QUICKNODE_RPC = process.env.QUICKNODE_API;
// const CHAINSTACK_RPC = process.env.CHAINSTACK_API;
const RPC = process.env.RPC;
const JUPITER_RPC = process.env.JUPITER_API;
const SECRET_KEY = process.env.SECRET_KEY;
const BUNDLE_API = process.env.BUNDLE_API as string;
const SEND_TX_RPCS = process.env.SEND_TX_RPCS?.split(',') as string[];
// 生成钱包
const payer = Keypair.fromSecretKey(new Uint8Array(bs58.decode(SECRET_KEY as string)));

// 从config.ts中导入配置
let {status,
    leverageSubmitNum,
    maxListen,
    adjustSlotInterval,
    checkSlotInterval,
    slotTolerance,
    minJitoTip,
    SendTxNoBundle,
    priorfee,
    cu_nums,
    directRoutes,
    feePercent,
    partformFeeBps,
    threshold,
    slotLimit,
    minProfitBps,
    tradePercent,
    JitoTipAccounts,
} = config;
let batchBundleApis = batchBundleApi;

// 构造RPC池
const rpc = RPC as string
const SEND_TX_RPCS_CLIENTS = SEND_TX_RPCS.map((rpc) => new Connection(rpc,status));
// 构造连接池
const con : Connection = new Connection(rpc, status);
const pubCon: Connection = new Connection(clusterApiUrl('mainnet-beta'), status);

// 创建Jupiter API客户端
const jupCon = createJupiterApiClient({basePath: JUPITER_RPC});

// 每5s更新一次blockhash
let getBlockHashInterval = 5000;
var blockhash_list:string[] = [];
var blockhash = (await pubCon.getLatestBlockhash()).blockhash;
blockhash_list.push(blockhash);
setInterval(async () => {
    try {
        blockhash = (await pubCon.getLatestBlockhash()).blockhash;
        blockhash_list.push(blockhash);
        if (blockhash_list.length > leverageSubmitNum) {
            blockhash_list.shift();
        }
    } catch (err) {
        console.error(`getLatestBlockhash error: ${err}`)
    }
}, getBlockHashInterval);

// 每checkSlotInterval检查一次slot
var latestSlot = (await con.getSlot(status));
setInterval(async () => {
    latestSlot += 1;
}, adjustSlotInterval);
setInterval(async () => {
    try {
        latestSlot = (await con.getSlot(status));
    } catch (err) {
        console.error(`getSlot error: ${err}`)
    }
}, checkSlotInterval);

// 每10min更新一次wsol余额
// let wsolMint = 'So11111111111111111111111111111111111111112';
let {symbol:mainSymbol,mint:mainMint} = trade_pairs.pair1;
var mainBalance = 0;
let ATA = await getAssociatedTokenAddress(new PublicKey(mainMint),payer.publicKey);
async function getMainBalance(ATA:PublicKey) : Promise<number> {
    try {
        const result = await pubCon.getTokenAccountBalance(ATA);
        return (Number(result.value.amount));
    } catch (err) {
        console.error(`get ${mainSymbol} Balance error:`)
        if (mainBalance > 0) {
            return mainBalance;
        } else {
            return 0;
        }
    }
}
let getBalanceInterval = 1000*60*10;
mainBalance = await getMainBalance(ATA);
if (mainBalance === 0) {
    console.error(`inital ${mainSymbol} Balance error:`)
    process.exit(1);
}
let trade_main = Math.floor(mainBalance*tradePercent);
console.log(`${mainSymbol} Balance: ${mainBalance} `);
setInterval(async () => {
    try {
        mainBalance = Math.floor((await getMainBalance(ATA))*tradePercent*100)/100;
    } catch (err) {
        console.error(`get ${mainSymbol} Balance error: ${err}`)
    }
}, getBalanceInterval);




// 保存addressLookupTableAccounts
let addLookupAccounts:AddressLookupTableAccount[] = [];
interface subscribeListItem {
    id:number,
    address:string,
    subid:number | null
}
let subscribeList:subscribeListItem[] = [];
const wsUrl = 'wss://api.mainnet-beta.solana.com/';
let ws:WebSocket;

function connectWebSocket() {
    // 创建 WebSocket 连接
    ws = new WebSocket(wsUrl);
    ws.on('open', () => {
        console.log('ws connected');
    });

    ws.on('message', async (data) => {
        try {
            let msg;
            if (os.platform() === 'win32') {
                msg = JSON.parse(Buffer.from(data as string, 'hex').toString('utf-8'));
            } else {
                msg = JSON.parse(data as string);
            }
            console.log(msg);
            if (msg.result) {
                if (msg.result === true) {
                    console.log(`Unsubscribe success, id: ${msg.id}`);
                } else {
                    let index = subscribeList.findIndex((sub) => sub.id === msg.id);
                    if (index !== -1) {
                        subscribeList[index].subid = msg.result;
                    } else {
                        console.error(`when update subscribeList, can't find the id... id: ${msg.id}`);
                    }
                }
            }
            if (msg.method === 'accountNotification') {
                const address = msg.params.result.value.parsed.info.authority;
                const result = await con.getAddressLookupTable(new PublicKey(address));
                let index = addLookupAccounts.findIndex((account) => account.key.toBase58() === new PublicKey(address).toBase58());
                if (index !== -1) {
                    addLookupAccounts[index] = result.value as AddressLookupTableAccount;
                    fs.appendFileSync('updateLookupAccounts.log', `${address},${result.value}\n`);
                } else {
                    console.error(`when update addressLookupTableAccounts, can't find the account...address: ${address}`);
                    fs.appendFileSync('updateLookupAccounts.log', `when update addressLookupTableAccounts, can't find the account...address: ${address}\n`);
                }
            }
        } catch (err) {
            console.error(`ws message error: ${err}`);
        }
    });

    ws.on('close', () => {
        console.log('ws closed');
        // 连接关闭时尝试重新连接
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            connectWebSocket();
            subscribeList = [];
            addLookupAccounts = [];
        }, 5000);  // 5秒后重连
    });

    ws.on('error', (err) => {
        console.error(`ws error: ${err}`);
        // 出现错误时也尝试重连
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            connectWebSocket();
            subscribeList = [];
            addLookupAccounts = [];
        }, 5000);  // 5秒后重连
    });
}

function subscribeAccount(address:string) {
    let id = Math.floor(Math.random() * 100000);
    let params = {
        "jsonrpc": "2.0",
        "id": id,
        "method": "accountSubscribe",
        "params": [
          address,
          {
            "encoding": "jsonParsed",
            "commitment": "finalized"
          }
        ]
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(params));
        subscribeList.push({id:id,address:address,subid:null});
    } else {
        console.error('WebSocket not connected');
    }
}

function unsubscribeAccount(address:string) {
    try {
        let subid = subscribeList.find((sub) => sub.address === address)?.subid;
        let id = subscribeList.find((sub) => sub.address === address)?.id;
        let params = {
            "jsonrpc": "2.0",
            "id": id,
            "method": "accountUnsubscribe",
            "params": [subid]
        }
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(params));
            subscribeList = subscribeList.filter((sub) => sub.address !== address);
            addLookupAccounts = addLookupAccounts.filter((account) => account.key.toBase58() !== address);
        } else {
            console.error('WebSocket not connected');
        }
    } catch (err) {
        console.error(`unsubscribeAccount error: ${err}`);
    }
}

// 连接
connectWebSocket();
// 保持连接
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.ping(); // 如果 WebSocket 支持 ping，可以使用此方法
        console.log('Sending heartbeat...');
    }
}, 10000);  // 每 10 秒发送一次心跳

// 设置最大监听数
const maxListenNum = maxListen;
setInterval(() => {
    // 如果addressLookupTableAccounts数量大于maxListenNum，取消订阅并且删除
    if (addLookupAccounts.length > maxListenNum) {
        let address = addLookupAccounts[0].key.toBase58();
        unsubscribeAccount(address);
    }
}, 3000);


// 监测套利机会
interface monitorParams {
    pair1:pair,
    pair2:pair,
    con:Connection,
    jupCon:DefaultApi
}
async function monitor(monitorParams:monitorParams) {
    const {pair1,pair2,con,jupCon} = monitorParams;
    // 获取交易对信息
    const pair1_to_pair2 : QuoteGetRequest = {
        inputMint: pair1.mint,
        outputMint: pair2.mint,
        amount: trade_main,
        // onlyDirectRoutes: false,
        onlyDirectRoutes: directRoutes,
        slippageBps: 0,
        maxAccounts: 28,
        swapMode: QuoteGetSwapModeEnum.ExactIn
    }
    const pair2_to_pair1 : QuoteGetRequest = {
        inputMint: pair2.mint,
        outputMint: pair1.mint,
        amount: trade_main,
        // onlyDirectRoutes: false,
        onlyDirectRoutes: directRoutes,
        slippageBps: 0,
        // maxAccounts: 30,
        swapMode: QuoteGetSwapModeEnum.ExactOut
    }

    try {
        const [quote0Resp ,quote1Resp] = await Promise.all([
            getQuote(pair1_to_pair2,jupCon,`${pair1.symbol} -> ${pair2.symbol}`),
            getQuote(pair2_to_pair1,jupCon,`${pair2.symbol} -> ${pair1.symbol}`)
        ])
        if (quote0Resp?.routePlan[0].swapInfo.ammKey === quote1Resp?.routePlan[0].swapInfo.ammKey) {
            console.log(`same pool, return...`)
            return;
        }
        if (latestSlot-slotTolerance > Number(quote0Resp?.contextSlot) || latestSlot-slotTolerance > Number(quote1Resp?.contextSlot)) {
            console.log(`quote is outdated, return...`)
            console.log(`latestSlot: ${latestSlot}, quote0 slot: ${quote0Resp?.contextSlot}, quote1 slot: ${quote1Resp?.contextSlot}`)
            return;
        }
        // console.log(`latestSlot: ${latestSlot}, quote0 slot: ${quote0Resp?.contextSlot}, quote1 slot: ${quote1Resp?.contextSlot}`)
        let slotDiff = Math.abs(Number(quote0Resp?.contextSlot)-Number(quote1Resp?.contextSlot))
        if (slotDiff > slotLimit) {
            console.log(`contextSlot difference ${slotDiff} exceed ${slotLimit}, return...`)
            return;
        }
        let total_fee_rate = 1;
        quote0Resp?.routePlan.forEach((route) => {
            total_fee_rate *= (1+Number(route.swapInfo.feeAmount)/Number(route.swapInfo.inAmount));
        })
        quote1Resp?.routePlan.forEach((route) => {
            total_fee_rate *= (1+Number(route.swapInfo.feeAmount)/Number(route.swapInfo.inAmount));
        })
        total_fee_rate = total_fee_rate + partformFeeBps/10000;
        let p1 = Number(quote0Resp?.outAmount)/Number(quote0Resp?.inAmount);
        let p2 = Number(quote1Resp?.inAmount)/Number(quote1Resp?.outAmount);
        if (p2/p1 > Math.max(threshold,total_fee_rate+minProfitBps/10000)) {
            console.log(`${pair1.symbol} to ${pair2.symbol} price: ${p1}`)
            console.log(`${pair2.symbol} to ${pair1.symbol} price: ${p2}`)
            console.log(`${pair1.symbol} -> ${pair2.symbol} -> ${pair1.symbol} total fee rate: ${total_fee_rate}`)
            console.log(`${pair1.symbol} -> ${pair2.symbol} -> ${pair1.symbol} price difference: ${p2/p1}`)

            // 计算Jito Tip
            let jitoTip = Math.max(minJitoTip,Math.floor((p2/p1-total_fee_rate)*trade_main*feePercent));

            let mergedQuoteResp = quote0Resp as QuoteResponse;
            mergedQuoteResp.outputMint = (quote1Resp as QuoteResponse).outputMint;
            mergedQuoteResp.outAmount = SendTxNoBundle ? (String(pair1_to_pair2.amount)) : (String(pair1_to_pair2.amount+jitoTip));
            mergedQuoteResp.otherAmountThreshold = SendTxNoBundle ? (String(pair1_to_pair2.amount)) : (String(pair1_to_pair2.amount+jitoTip));
            mergedQuoteResp.priceImpactPct = String(0);
            mergedQuoteResp.routePlan = mergedQuoteResp.routePlan.concat((quote1Resp as QuoteResponse).routePlan);

            let swapData : SwapRequest = {
                "userPublicKey": payer.publicKey.toBase58(),
                "wrapAndUnwrapSol": false,
                "useSharedAccounts": false,
                "skipUserAccountsRpcCalls": true,
                "quoteResponse": mergedQuoteResp,
              }
            try {
                let start = new Date().getTime();
                let instructions = await jupCon.swapInstructionsPost({ swapRequest: swapData })
                console.log(`(${pair1.symbol},${pair2.symbol}) swapInstructionsPost time cost:`,new Date().getTime()-start)

                let ixs : TransactionInstruction[] = [];
                let cu_ixs : TransactionInstruction[] = [];
                let cu_num = cu_nums;

                // 1. setup instructions
                const setupInstructions = instructions.setupInstructions.map(instructionFormat);
                ixs = ixs.concat(setupInstructions);

                // 2. swap instructions
                const swapInstructions = instructionFormat(instructions.swapInstruction);
                ixs.push(swapInstructions);

                // 3. 调用computeBudget设置cu
                const computeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
                    units: cu_num,
                })
                cu_ixs.push(computeUnitLimitInstruction);

                // 4. 调用computeBudget设置优先费
                const computeUnitPriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                    // microLamports: 66666,
                    microLamports:priorfee,
                })
                cu_ixs.push(computeUnitPriceInstruction);
                // 合并cu_ixs
                ixs = cu_ixs.concat(ixs);

                // 5. JiTo Tip
                if (!SendTxNoBundle) {
                    const tipInstruction = SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: new PublicKey(JitoTipAccounts[Math.floor(Math.random()*JitoTipAccounts.length)]),
                        lamports: jitoTip,
                    })
                    ixs.push(tipInstruction);
                }

                const addressLookupTableAccounts = await Promise.all(
                    instructions.addressLookupTableAddresses.map(async (address) => {
                        let index = addLookupAccounts.findIndex((account) => account.key.toBase58() === new PublicKey(address).toBase58());
                        if (index !== -1) {
                            return addLookupAccounts[index];
                        } else {
                            const result = await con.getAddressLookupTable(new PublicKey(address));
                            addLookupAccounts.push(result.value as AddressLookupTableAccount);
                            subscribeAccount(address);
                            return result.value as AddressLookupTableAccount;
                        }
                    })
                );

                // v0 tx
                // const { blockhash } = await con.getLatestBlockhash();
                let txs : VersionedTransaction[] = [];
                blockhash_list.map((blockhash) => {
                    const messageV0 = new TransactionMessage({
                        payerKey: payer.publicKey,
                        recentBlockhash: blockhash,
                        instructions: ixs,
                    }).compileToV0Message(addressLookupTableAccounts);
                    const transaction = new VersionedTransaction(messageV0);
                    transaction.sign([payer]);
                    txs.push(transaction);
                });

                // console.log('generate tx cost:',new Date().getTime()-start)
                console.log(`(${pair1.symbol},${pair2.symbol}) generate tx cost:`,new Date().getTime()-start)
                // send tx
                try {
                    // await sendTxToBundle(transaction,BUNDLE_API);
                    // await sendTxToJito(transaction,BUNDLE_API);
                    let promises : Promise<void>[] = [];
                    if (SendTxNoBundle) {
                        // await batchSendTxToRpcs(transaction,SEND_TX_RPCS_CLIENTS);
                        for (let i = 0; i < txs.length; i++) {
                            promises.push(sendTxToRpc(txs[i],SEND_TX_RPCS_CLIENTS[i%SEND_TX_RPCS_CLIENTS.length]));
                        }
                    } else {
                        // await batchSendTxToBundle(transaction,batchBundleApis);
                        for (let i = 0; i < txs.length; i++) {
                            promises.push(sendTxToBundle(txs[i],batchBundleApis[i%batchBundleApis.length]));
                        }
                    }
                    await Promise.all(promises);
                    // await batchSendTxToJito(transaction,batchBundleApis);
                    console.log(`(${pair1.symbol},${pair2.symbol}) from generate to send tx cost:`,new Date().getTime()-start)
                } catch (err) {
                    console.error(`(${pair1.symbol},${pair2.symbol}) sendTxToCons error:`)
                } 
            } catch (err) {
                console.error(`(${pair1.symbol},${pair2.symbol}) swapInstructions generate error:`)
            }
        } 
    } catch (err) {
        console.error(`(${pair1.symbol},${pair2.symbol}) getQuote error:`)
    }
}

// 主函数
let {waitTime,pair1,getPairsInterval} = trade_pairs;
var pair2s:pair[];
if (trade_pairs.pair2s.length > 0) {
    pair2s = trade_pairs.pair2s;
} else {
    pair2s = await getPairs();
    // 每隔一段时间获取一次交易对
    setInterval(async () => {
        try {
            pair2s = await getPairs();
        } catch (err) {
            console.error(`getPairs error, use last pairs...`)
        }
    }, getPairsInterval);
}

let num = 0;
async function main(num:number) {
    // 监测套利机会
    await monitor({
        pair1:pair1,
        pair2:pair2s[num],
        con:con,
        jupCon:jupCon
    })
    console.log(`waiting for ${waitTime}s...`)
    await wait(waitTime*1000);
    main((num+1)%pair2s.length);
}

main(num).then(() => {
    console.log('start next round...')
}).catch((err) => {
    console.error(err);
});