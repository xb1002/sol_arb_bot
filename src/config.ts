import {LAMPORTS_PER_SOL, Commitment} from '@solana/web3.js';

export const config = {
    status: "confirmed" as Commitment, // 确认状态
    jitoTip:0.000003* LAMPORTS_PER_SOL, // 单位LAMPORTS
    initalTradeSol:0.6, // 单位SOL
    threshold:1.005, // 阈值
    tradePercent:0.98, // 交易总的wsol比例
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
    bundle_apis : [
        "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
        "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
        "https://mainnet.block-engine.jito.wtf/api/v1/bundles"
    ]
}

// gmgn查询参数
type timeSpanType = '5m' | '1h' | '6h' 
interface timeSpan {
    timeSpan: timeSpanType
}
export const getPairsParams = {
    timeSpan: '5m' as timeSpanType,
    pairNum : 7
}

export interface pair {
    symbol: string,
    mint: string
}
export const trade_pairs = {
    waitTime: 0.3, // 单位秒
    pair1: {symbol: "wsol", mint: "So11111111111111111111111111111111111111112"} as pair,
    getPairsInterval: 1000*60*30, // 单位毫秒
}