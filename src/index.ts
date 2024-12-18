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
import { wait, instructionFormat, getQuote, sendTxToCons } from './lib.js';
import { config,trade_pairs } from './config.js';

// 导入环境变量
const QUICKNODE_RPC = process.env.QUICKNODE_API;
const CHAINSTACK_RPC = process.env.CHAINSTACK_API;
const JUPITER_RPC = process.env.JUPITER_API;
const SECRET_KEY = process.env.SECRET_KEY;
// 生成钱包
const payer = Keypair.fromSecretKey(new Uint8Array(bs58.decode(SECRET_KEY as string)));

// 从config.ts中导入配置
let {status,
    jitoTip,
    initalTradeSol,
    threshold,
    JitoTipAccounts,
    bundle_apis
} = config;
let trade_sol = initalTradeSol;

// 构造RPC池
const rpcs : string[] = [QUICKNODE_RPC as string, CHAINSTACK_RPC as string];
// 构造连接池
const cons : Connection[] = rpcs.map((rpcUrl) => new Connection(rpcUrl, status));
const pubCon: Connection = new Connection(clusterApiUrl('mainnet-beta'), status);

// 创建Jupiter API客户端
const jupCon = createJupiterApiClient({basePath: JUPITER_RPC});

// 每20s更新一次blockhash
let getBlockHashInterval = 20000;
var blockhash = (await pubCon.getLatestBlockhash()).blockhash;
setInterval(async () => {
    try {
        blockhash = (await pubCon.getLatestBlockhash()).blockhash;
    } catch (err) {
        console.error(`getLatestBlockhash error: ${err}`)
    }
}, getBlockHashInterval);

// 每5min更新一次wsol余额
let wsolMint = 'So11111111111111111111111111111111111111112';
let ATA = await getAssociatedTokenAddress(new PublicKey(wsolMint),payer.publicKey);
async function getWsolBalance(ATA:PublicKey) {
    try {
        const result = await pubCon.getTokenAccountBalance(ATA);
        return result.value.uiAmount;
    } catch (err) {
        console.error(`getWsolBalance error:`)
    }
}
let getWsolBalanceInterval = 1000*60*5;
var wsolBalance =await getWsolBalance(ATA);
console.log(`wsolBalance: ${wsolBalance} sol`);
setInterval(async () => {
    wsolBalance = await getWsolBalance(ATA);
}, getWsolBalanceInterval);

// 保存addressLookupTableAccount信息，并且每8s更新一个batch
let addressLookupTableAccount_list : AddressLookupTableAccount[] = [];
let maxAddressLookupTableAccount = 200;
let addressLookupTableAccountBatch = 5;
let addressLookupTableAccountBatchNum = 0;
let addressLookupTableAccountBatchInterval = 8*1000;
async function _getAddressLookupTable(item:AddressLookupTableAccount) {
    try {
        const result = await pubCon.getAddressLookupTable(item.key);
        addressLookupTableAccount_list.push(result.value as AddressLookupTableAccount);
    } catch (err) {
        console.error(`getAddressLookupTable error:`)
    }
}
setInterval(async () => {
    // 处理多余的addressLookupTableAccount
    let totalNum = addressLookupTableAccount_list.length
    if (totalNum === 0) {
        return;
    }
    if (totalNum > maxAddressLookupTableAccount) {
        addressLookupTableAccount_list = addressLookupTableAccount_list.slice(
            totalNum-maxAddressLookupTableAccount,totalNum
        );
    }
    // 更新addressLookupTableAccount
    if (addressLookupTableAccountBatchNum+addressLookupTableAccountBatch > totalNum) {
        addressLookupTableAccount_list.slice(addressLookupTableAccountBatchNum,totalNum).map(async (item) => {
            _getAddressLookupTable(item);
        })
        addressLookupTableAccountBatchNum = 0;
    } else {
        addressLookupTableAccount_list.slice(addressLookupTableAccountBatchNum,addressLookupTableAccountBatchNum+addressLookupTableAccountBatch).map(async (item) => {
            _getAddressLookupTable(item);
        })
        addressLookupTableAccountBatchNum += addressLookupTableAccountBatch;
    }
}, addressLookupTableAccountBatchInterval);

// 监测套利机会
interface monitorParams {
    pair1:string,
    pair2:string,
    con:Connection,
    jupCon:DefaultApi
}
async function monitor(monitorParams:monitorParams) {
    const {pair1,pair2,con,jupCon} = monitorParams;
    // 获取交易对信息
    const pair1_to_pair2 : QuoteGetRequest = {
        inputMint: pair1,
        outputMint: pair2,
        amount: LAMPORTS_PER_SOL*trade_sol,
        onlyDirectRoutes: true,
        slippageBps: 0,
        maxAccounts: 30,
        swapMode: QuoteGetSwapModeEnum.ExactIn
    }
    const pair2_to_pair1 : QuoteGetRequest = {
        inputMint: pair2,
        outputMint: pair1,
        amount: LAMPORTS_PER_SOL*trade_sol,
        onlyDirectRoutes: true,
        slippageBps: 0,
        // maxAccounts: 30,
        swapMode: QuoteGetSwapModeEnum.ExactOut
    }

    try {
        const [quote0Resp ,quote1Resp] = await Promise.all([
            getQuote(pair1_to_pair2,jupCon,"pair1_to_pair2"),
            getQuote(pair2_to_pair1,jupCon,"pair2_to_pair1")
        ])
        if (quote0Resp?.routePlan[0].swapInfo.ammKey === quote1Resp?.routePlan[0].swapInfo.ammKey) {
            console.log(`same pool, return...`)
            return;
        }
        let p1 = Number(quote0Resp?.outAmount)/Number(quote0Resp?.inAmount);
        let p2 = Number(quote1Resp?.inAmount)/Number(quote1Resp?.outAmount);
        if (p2/p1 > threshold) {
            console.log(`pair1_to_pair2: ${p1}`)
            console.log(`pair2_to_pair1: ${p2}`)
            console.log(`pair2_to_pair1/pair1_to_pair2: ${p2/p1}`)

            let mergedQuoteResp = quote0Resp as QuoteResponse;
            mergedQuoteResp.outputMint = (quote1Resp as QuoteResponse).outputMint;
            mergedQuoteResp.outAmount = String(pair1_to_pair2.amount);
            mergedQuoteResp.otherAmountThreshold = String(pair1_to_pair2.amount);
            mergedQuoteResp.priceImpactPct = "0";
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
                console.log(`swapInstructionsPost time cost:`,new Date().getTime()-start)

                let ixs : TransactionInstruction[] = [];
                let cu_ixs : TransactionInstruction[] = [];
                let cu_num = 200000;

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
                    microLamports: 12345,
                })
                cu_ixs.push(computeUnitPriceInstruction);
                // 合并cu_ixs
                ixs = cu_ixs.concat(ixs);

                // 5. JiTo Tip
                const tipInstruction = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: new PublicKey(JitoTipAccounts[Math.floor(Math.random()*JitoTipAccounts.length)]),
                    lamports: jitoTip,
                })
                ixs.push(tipInstruction);

                // ALT
                const addressLookupTableAccounts = await Promise.all(
                    instructions.addressLookupTableAddresses.map(async (address) => {
                        if (addressLookupTableAccount_list.length > 0) {
                            const result = addressLookupTableAccount_list.find((item) => item.key.toBase58() === address);
                            if (result) {
                                return result;
                            }
                        }
                        const result = await con.getAddressLookupTable(new PublicKey(address));
                        addressLookupTableAccount_list.push(result.value as AddressLookupTableAccount);
                        return result.value as AddressLookupTableAccount;
                    })
                );

                // v0 tx
                // const { blockhash } = await con.getLatestBlockhash();
                const messageV0 = new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: blockhash,
                    instructions: ixs,
                }).compileToV0Message(addressLookupTableAccounts);
                const transaction = new VersionedTransaction(messageV0);
                transaction.sign([payer]);

                console.log('generate tx cost:',new Date().getTime()-start)
                // send tx
                try {
                    await sendTxToCons(transaction,bundle_apis);
                    console.log('from generate to send tx cost:',new Date().getTime()-start)
                } catch (err) {
                    console.error(`sendTxToCons error:`)
                } 
            } catch (err) {
                console.error(`swapInstructionsPost error:`)
            }
        } 
    } catch (err) {
        console.error(`getQuote error:`)
    }
}

// 主函数
let {waitTime,pair1,pair2s} = trade_pairs;
let num = 0;
async function main(num:number) {
    // 监测套利机会
    await monitor({
        pair1:pair1,
        pair2:pair2s[num],
        con:cons[Math.floor(Math.random()*cons.length)],
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