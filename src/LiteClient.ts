import { Address, Bytes, Integer, Range, BigNumber } from 'wakkanay/dist/types'
import { IWallet } from 'wakkanay/dist/wallet'
import { FreeVariable } from 'wakkanay/dist/ovm'
import { DepositContract } from 'wakkanay-ethereum/dist/contract'
import { IDepositContract, IERC20Contract } from 'wakkanay/dist/contract'
import { config } from 'dotenv'
import { Property } from 'wakkanay/dist/ovm'
import Coder from 'wakkanay-ethereum/dist/coder'
import { KeyValueStore, RangeDb } from 'wakkanay/dist/db'
import { StateUpdate, Transaction } from 'wakkanay-ethereum-plasma'
import axios from 'axios'
import { DecoderUtil } from 'wakkanay/dist/utils'
config()

const DEPOSIT_CONTRACT_ADDRESS = Address.from(
  process.env.DEPOSIT_CONTRACT_ADDRESS as string
)
const ETH_ADDRESS = Address.from(process.env.ETH_ADDRESS as string)
const THERE_EXISTS_ADDRESS = Address.from(process.env.THERE_EXISTS_ADDRESS)
const IS_VALID_SIGNATURE_ADDRESS = Address.from(
  process.env.IS_VALID_SIG_ADDRESS
)

// TODO: extract and use compiled property
function ownershipProperty(owner: Address) {
  const hint = Bytes.fromString('tx,key')
  const sigHint = Bytes.fromString('sig,key')
  return new Property(THERE_EXISTS_ADDRESS, [
    hint,
    Bytes.fromString('tx'),
    Coder.encode(
      new Property(THERE_EXISTS_ADDRESS, [
        sigHint,
        Bytes.fromString('sig'),
        Coder.encode(
          new Property(IS_VALID_SIGNATURE_ADDRESS, [
            FreeVariable.from('tx'),
            FreeVariable.from('sig'),
            Coder.encode(owner),
            Bytes.fromString('secp256k1')
          ]).toStruct()
        )
      ]).toStruct()
    )
  ])
}

export default class LiteClient {
  // private kvs: db.IndexedDbKeyValueStore
  private depositContracts: Map<string, IDepositContract> = new Map()
  private tokenContracts: Map<string, IERC20Contract> = new Map()

  constructor(
    private wallet: IWallet,
    private kvs: KeyValueStore,
    private depositContractFactory: (address: Address) => DepositContract,
    private tokenContractFactory: (address: Address) => IERC20Contract
  ) {
    // this.kvs = new db.IndexedDbKeyValueStore()
    this.depositContracts.set(
      ETH_ADDRESS.data,
      depositContractFactory(DEPOSIT_CONTRACT_ADDRESS)
    )
    this.tokenContracts.set(ETH_ADDRESS.data, tokenContractFactory(ETH_ADDRESS))
  }

  public start() {
    this.fetchState()
  }

  private async fetchState() {
    const res = await axios.get(
      `${process.env.AGGREGATOR_HOST}/sync_state?address=${this.address}`
    )
    const stateUpdates = res.data.map(
      (s: string) =>
        new StateUpdate(
          DecoderUtil.decodeStructable(Property, Coder, Bytes.fromHexString(s))
        )
    )
    this.syncState(stateUpdates)
  }

  // sync latest state
  private async syncState(stateUpdates: StateUpdate[]) {
    const stateDb = await this.kvs.bucket(Bytes.fromString('state'))
    const promises = stateUpdates.map(async su => {
      const kvs = await stateDb.bucket(
        Bytes.fromHexString(su.depositContractAddress.data)
      )
      const db = new RangeDb(kvs)
      const record = su.toRecord()
      await db.put(
        su.range.start.data,
        su.range.end.data,
        Coder.encode(record.toStruct())
      )
    })
    await Promise.all(promises)
    console.log(await this.getBalance())
  }

  /**
   * Deposit to plasma
   * @param amount amount to deposit
   * @param tokenAddress ERC20 token address, undefined for ETH
   */
  public async deposit(amount: number, tokenAddress?: Address) {
    const depositContract = this.getDepositContract(tokenAddress || ETH_ADDRESS)
    const tokenContract = this.getTokenContract(tokenAddress || ETH_ADDRESS)

    console.log('deposit called')
    console.log(tokenAddress)

    console.log(depositContract, tokenContract)
    if (!depositContract || !tokenContract) {
      throw new Error('Contract not found.')
    }

    const myAddress = this.wallet.getAddress()
    await tokenContract.approve(depositContract.address, Integer.from(amount))
    await depositContract.deposit(
      Integer.from(amount),
      ownershipProperty(myAddress)
    )
    console.log('deposit', amount, tokenAddress)
  }

  public async transfer(
    amount: number,
    depositContractAddress: Address,
    to: Address
  ) {
    console.log('transfer :', amount, depositContractAddress, to)
    const token = await this.searchRange(amount, depositContractAddress)
    if (!token) {
      throw new Error('Not enough amount')
    }

    const property = ownershipProperty(to)
    const tx = new Transaction(
      depositContractAddress,
      new Range(
        token.range.start,
        BigNumber.from(token.range.start.data + BigInt(amount))
      ),
      property
    )

    await axios.post(`${process.env.AGGREGATOR_HOST}/send_tx`, {
      tx: Coder.encode(tx.toStruct()).toHexString()
    })
  }

  private async searchRange(
    amount: number,
    tokenAddress: Address
  ): Promise<StateUpdate | undefined> {
    const db = await this.getStateDb(tokenAddress)
    const stateUpdates = await db.get(0n, 10000n)
    return stateUpdates
      .map(StateUpdate.fromRangeRecord)
      .find(su => su.amount > BigInt(amount))
  }

  private getDepositContract(
    tokenAddress: Address
  ): IDepositContract | undefined {
    return this.depositContracts.get(tokenAddress.data)
  }

  private getTokenContract(tokenAddress: Address): IERC20Contract | undefined {
    return this.tokenContracts.get(tokenAddress.data)
  }

  public registerToken(tokenAddress: Address, depositContractAddress: Address) {
    console.log('contracts set for token:', tokenAddress.data)
    const depositContract = this.depositContractFactory(depositContractAddress)
    this.depositContracts.set(depositContractAddress.data, depositContract)
    this.depositContracts.set(tokenAddress.data, depositContract)
    this.tokenContracts.set(
      tokenAddress.data,
      this.tokenContractFactory(tokenAddress)
    )
  }

  public get address(): string {
    return this.wallet.getAddress().data
  }

  public async getBalance(): Promise<
    Array<{
      tokenAddress: string
      amount: number
    }>
  > {
    const addrs = Array.from(this.depositContracts.keys())
    const resultPromise = addrs.map(async addr => {
      const db = await this.getStateDb(Address.from(addr))
      const data = await db.get(0n, 10000n) // todo: fix get all
      return {
        tokenAddress: addr,
        amount: data.reduce((p, c) => p + Number(c.end.data - c.start.data), 0)
      }
    })
    return await Promise.all(resultPromise)
  }

  private async getStateDb(addr: Address): Promise<RangeDb> {
    const stateDb = await this.kvs.bucket(Bytes.fromString('state'))
    const bucket = await stateDb.bucket(Bytes.fromHexString(addr.data))
    return new RangeDb(bucket)
  }
}
