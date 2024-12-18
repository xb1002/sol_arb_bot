import {LAMPORTS_PER_SOL, Commitment} from '@solana/web3.js';

export const config = {
    status: "confirmed" as Commitment, // 确认状态
    jitoTip:0.000002* LAMPORTS_PER_SOL, // 单位LAMPORTS
    initalTradeSol:0.35, // 单位SOL
    threshold:1.004, // 阈值
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

export const trade_pairs = {
    waitTime: 1, // 单位秒
    pair1: "So11111111111111111111111111111111111111112",
    pair2s: [
        "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
        "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump",
        "5voS9evDjxF589WuEub5i4ti7FWQmZCsAsyD5ucbuRqM",
        "42PZx7bPF1EMnP9L7vcjihTx7Nryxh81GG9Xs6fdpump",
        "892DtJWGTgidC9uX4kPtWq5FXxaYgg8CBjhphtUwpump"
    ]
}