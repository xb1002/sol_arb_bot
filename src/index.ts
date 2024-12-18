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
import { wait, instructionFormat, getQuote, sendTxToCons,getPairs } from './lib.js';
import { config,trade_pairs,pair } from './config.js';

// 导入环境变量
// const QUICKNODE_RPC = process.env.QUICKNODE_API;
// const CHAINSTACK_RPC = process.env.CHAINSTACK_API;
const RPC = process.env.RPC;
const JUPITER_RPC = process.env.JUPITER_API;
const SECRET_KEY = process.env.SECRET_KEY;
// 生成钱包
const payer = Keypair.fromSecretKey(new Uint8Array(bs58.decode(SECRET_KEY as string)));

// 从config.ts中导入配置
let {status,
    jitoTip,
    initalTradeSol,
    threshold,
    tradePercent,
    JitoTipAccounts,
    bundle_apis
} = config;

// 构造RPC池
const rpc = RPC as string
// 构造连接池
const con : Connection = new Connection(rpc, status);
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

// 每10min更新一次wsol余额
let wsolMint = 'So11111111111111111111111111111111111111112';
let ATA = await getAssociatedTokenAddress(new PublicKey(wsolMint),payer.publicKey);
async function getWsolBalance(ATA:PublicKey) : Promise<number> {
    try {
        const result = await pubCon.getTokenAccountBalance(ATA);
        return (result.value.uiAmount as number);
    } catch (err) {
        console.error(`getWsolBalance error:`)
        return initalTradeSol;
    }
}
let getWsolBalanceInterval = 1000*60*10;
var wsolBalance = await getWsolBalance(ATA);
let trade_sol = Math.floor(wsolBalance*tradePercent*100)/100;
console.log(`wsolBalance: ${wsolBalance} sol`);
setInterval(async () => {
    try {
        wsolBalance = Math.floor((await getWsolBalance(ATA))*tradePercent*100)/100;
    } catch (err) {
        console.error(`getWsolBalance error: ${err}`)
    }
}, getWsolBalanceInterval);

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
        amount: LAMPORTS_PER_SOL*trade_sol,
        onlyDirectRoutes: true,
        slippageBps: 0,
        maxAccounts: 30,
        swapMode: QuoteGetSwapModeEnum.ExactIn
    }
    const pair2_to_pair1 : QuoteGetRequest = {
        inputMint: pair2.mint,
        outputMint: pair1.mint,
        amount: LAMPORTS_PER_SOL*trade_sol,
        onlyDirectRoutes: true,
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
        let p1 = Number(quote0Resp?.outAmount)/Number(quote0Resp?.inAmount);
        let p2 = Number(quote1Resp?.inAmount)/Number(quote1Resp?.outAmount);
        if (p2/p1 > threshold) {
            console.log(`${pair1.symbol} to ${pair2.symbol} price: ${p1}`)
            console.log(`${pair2.symbol} to ${pair1.symbol} price: ${p2}`)
            console.log(`${pair1.symbol} -> ${pair2.symbol} -> ${pair1.symbol} price difference: ${p2/p1}`)

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
                console.log(`(${pair1.symbol},${pair2.symbol}) swapInstructionsPost time cost:`,new Date().getTime()-start)

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
                        const result = await con.getAddressLookupTable(new PublicKey(address));
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

                // console.log('generate tx cost:',new Date().getTime()-start)
                console.log(`(${pair1.symbol},${pair2.symbol}) generate tx cost:`,new Date().getTime()-start)
                // send tx
                try {
                    await sendTxToCons(transaction,bundle_apis);
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
var pair2s = await getPairs();
// 每隔一段时间获取一次交易对
setInterval(async () => {
    try {
        pair2s = await getPairs();
    } catch (err) {
        console.error(`getPairs error, use last pairs...`)
    }
}, getPairsInterval);

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