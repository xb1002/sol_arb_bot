import { PublicKey, Connection, VersionedTransaction } from '@solana/web3.js';
import { Instruction, QuoteGetRequest, DefaultApi } from '@jup-ag/api';
import bs58 from 'bs58';
import axios from 'axios';

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
export async function sendTxToCons(tx:VersionedTransaction,bundle_apis:string[]) {
    try {
        const serializedTransaction = tx.serialize();
        const base58Transaction = bs58.encode(serializedTransaction);
        const bundle = {
            jsonrpc: "2.0",
            id: 1,
            method: "sendBundle",
            params: [[base58Transaction]]
        };
        bundle_apis.map(async (api) => {
                axios.post(api, bundle, {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).then((resp) => {
                    console.log(`sent bundle, id: ${resp.data.result}`)
                }).catch((err) => {
                    console.error(`send bundle error:`)
                })
        })
    } catch (err) {
        console.error(`sendTxToCons error:`)
    }
}