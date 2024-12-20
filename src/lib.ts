import { PublicKey, Connection, VersionedTransaction } from '@solana/web3.js';
import { Instruction, QuoteGetRequest, DefaultApi } from '@jup-ag/api';
import {getPairsParams, pair} from './config.js'
import bs58 from 'bs58';
import axios from 'axios';
import fs from 'fs';

export function instructionFormat(instruction : Instruction) {
    return {
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((account) => ({
            pubkey: new PublicKey(account.pubkey),
            isSigner: account.isSigner,
            isWritable: account.isWritable
        })),
        data: Buffer.from(instruction.data, 'base64')
    };
  }

export async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取报价
export async function getQuote(quoteParams:QuoteGetRequest,jupCon:DefaultApi,name:string) {
    let start = new Date().getTime();
    try {
        const quoteResp = await jupCon.quoteGet(quoteParams)
        console.log(`${name} getQuote time cost:`,new Date().getTime()-start)
        return quoteResp;
    } catch (err) {
        console.error(`${name} getQuote error:`)
    }
}

// 发送交易
export async function sendTxToBundle(tx:VersionedTransaction,bundle_api:string) {
    try {
        const serializedTransaction = tx.serialize();
        const base58Transaction = bs58.encode(serializedTransaction);
        const bundle = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [[base58Transaction]]
        };
        axios.post(new URL("api/v1/bundles",bundle_api).href, bundle, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).then((resp) => {
            console.log(`sent bundle, id: ${resp.data.result}`)
            // 保存到log文件
            fs.appendFile('./log.txt', `${new Date().toLocaleString()} -> sent bundle, id: ${resp.data.result}\n`, (err) => {
                if (err) {
                    console.error(`write log error: ${err}`)
                }
            })
        }).catch((err) => {
            console.error(`send bundle error: ${err}`)
        })
    } catch (err) {
        console.error(`sendTxToCons error: ${err}`)
    }
}

export async function batchSendTxToBundle(txs:VersionedTransaction,bundle_apis:string[]) {
    try {
        bundle_apis.map(async (bundle_api) => {
            await sendTxToBundle(txs,bundle_api)
        })
    } catch (err) {
        console.error(`batchSendTxToBundle error: ${err}`)
    }
}

export async function sendTxToJito(tx:VersionedTransaction,bundle_api:string) {
    try {
        const serializedTransaction = tx.serialize();
        const base58Transaction = bs58.encode(serializedTransaction);
        const params = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [base58Transaction]
        };
        axios.post(new URL("api/v1/transactions",bundle_api).href, params, {
            headers: {
                'Content-Type': 'application/json'
            }
        }).then((resp) => {
            console.log(`sent tx: ${resp.data.result}`)
            // 保存到log文件
            fs.appendFile('./log.txt', `${new Date().toLocaleString()} -> sent tx: ${resp.data.result}\n`, (err) => {
                if (err) {
                    console.error(`write log error: ${err}`)
                }
            })
        }).catch((err) => {
            console.error(`sendTxToJito error: ${err}`)
        })
    } catch (err) {
        console.error(`sendTxToJito error: ${err}`)
    }
}

export async function batchSendTxToJito(txs:VersionedTransaction,bundle_apis:string[]) {
    try {
        bundle_apis.map(async (bundle_api) => {
            await sendTxToJito(txs,bundle_api)
        })
    } catch (err) {
        console.error(`batchSendTxToJito error: ${err}`)
    }
}

export async function sendTxToRpc(tx:VersionedTransaction,connection:Connection) {
    try {
        await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 0
        }).then((resp) => {
            console.log(`sent tx: ${resp}`)
            // 保存到log文件
            fs.appendFile('./log.txt', `${new Date().toLocaleString()} -> sent tx: ${resp}\n`, (err) => {
                if (err) {
                    console.error(`write log error: ${err}`)
                }
            })
        }).catch((err) => {
            console.error(`sendTxToRpc error: ${err}`)
        })
    } catch (err) {
        console.error(`sendTxToRpc error: ${err}`)
    }
}

export async function batchSendTxToRpcs(tx:VersionedTransaction,connections:Connection[]) {
    try {
        connections.map(async (connection) => {
            await sendTxToRpc(tx,connection)
        })
    } catch (err) {
        console.error(`batchSendTxToRpcs error: ${err}`)
    }
}

// 从gmgnai获取交易对
export async function getPairs() : Promise<pair[]> {
    let timeSpan = getPairsParams.timeSpan;
    try {
        const url = `http://47.237.120.213:9488/defi/quotation/v1/rank/sol/swaps/${timeSpan}?orderby=volume&direction=desc&filters[]=renounced&filters[]=frozen&filters[]=burn&filters[]=distribed`
        let resp = await axios.get(url);
        if (resp.data.code != 0) {
            throw new Error(`getPairs error, code: ${resp.data.code}, msg: ${resp.data.msg}`)
        } else {
            let result = resp.data.data.rank.slice(0,getPairsParams.pairNum).map((pair:any) => {
                return {
                    symbol: pair.symbol,
                    mint: pair.address
                }
            })
            return result as pair[];
        }
    } catch (err) {
        throw new Error(`getPairs error: ${err}`)
    }
}