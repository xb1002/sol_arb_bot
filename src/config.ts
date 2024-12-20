import {LAMPORTS_PER_SOL, Commitment} from '@solana/web3.js';

export const config = {
    status: "confirmed" as Commitment, // 确认状态
    maxListen: 200, // 最大监听数
    minJitoTip:0.000005* LAMPORTS_PER_SOL, // 单位LAMPORTS
    SendTxNoBundle: false, // 是否不使用bundle发送交易, 需要设置SEND_TX_RPCS, false为使用bundle发送交易, true为不使用bundle发送交易
    priorfee: 23456, // 优先费用,单位MicroLamports
    cu_nums: 666666, // 计算单元数,如果是直接路由,则需要推荐值为199999,如果是间接路由,则需要推荐值为400000
    directRoutes: false, // 是否只使用直接路由
    feePercent:0, // jito tip比例,如果不是使用wsol交易,则需要设置为0
    threshold:1.01, // 阈值
    tradePercent:0.9, // 交易总的pair1比例
    JitoTipAccounts: [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
    ],
}

export const batchBundleApi = [
    "https://mainnet.block-engine.jito.wtf",
    "https://ny.mainnet.block-engine.jito.wtf",
    "https://tokyo.mainnet.block-engine.jito.wtf",
    "https://frankfurt.mainnet.block-engine.jito.wtf"
]

// gmgn查询参数
type timeSpanType = '1m' |'5m' | '1h' | '6h' | '24h'
interface timeSpan {
    timeSpan: timeSpanType
}
export const getPairsParams = {
    timeSpan: '24h' as timeSpanType,
    pairNum : 7,
}

export interface pair {
    symbol: string,
    mint: string
}
export const trade_pairs = {
    waitTime: 0.35, // 单位秒
    // pair1: {symbol: "wsol", mint: "So11111111111111111111111111111111111111112"} as pair,
    pair1: {symbol: "usdc", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"} as pair,
    getPairsInterval: 1000*60*3, // 单位毫秒
}