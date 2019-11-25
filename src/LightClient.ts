import { db } from 'wakkanay'

export default class LightClient {
  private kvs: db.IndexedDbKeyValueStore

  constructor() {
    this.kvs = new db.IndexedDbKeyValueStore()
  }

  public init() {
    console.log('Initialize light client')
  }

  public get address(): string {
    return '0x0472ec0185ebb8202f3d4ddb0226998889663cf2'
  }

  public get balance(): Array<{
    tokenAddress: string
    tokenName: string
    amount: number
  }> {
    return [
      {
        tokenAddress: '0x0000000000000000000000000000000000000000',
        tokenName: 'eth',
        amount: 1.2
      },
      {
        tokenAddress: '0x0000000000000000000000000000000000000001',
        tokenName: 'dai',
        amount: 204
      }
    ]
  }
}
