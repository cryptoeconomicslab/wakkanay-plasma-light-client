import { Address, Bytes, Integer, Range, BigNumber } from 'wakkanay/dist/types'
import { IWallet } from 'wakkanay/dist/wallet'
import { FreeVariable } from 'wakkanay/dist/ovm'
import { DepositContract } from 'wakkanay-ethereum/dist/contract'
import { IDepositContract, IERC20Contract } from 'wakkanay/dist/contract'
import { config } from 'dotenv'
import { Property } from 'wakkanay/dist/ovm'
import Coder from 'wakkanay-ethereum/dist/coder'
import { KeyValueStore, RangeDb } from 'wakkanay/dist/db'
import { StateUpdate, Transaction, Block } from 'wakkanay-ethereum-plasma'
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

  public get address(): string {
    return this.wallet.getAddress().data
  }

  /**
   * get balance method
   * returns array of {tokenAddress: string, amount: number}
   */
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

  /**
   * start LiteClient process.
   */
  public async start() {
    await this.fetchState()
  }

  /**
   * fetch latest state from aggregator
   * update local database with new state updates.
   */
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
    await this.syncState(stateUpdates)
  }

  /**
   * sync given list of state updates to local database.
   * @param stateUpdates list of state update to sync with local database
   */
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
  }

  /**
   * Handle newly submitted block.
   * client verifies all the state updates included within the block by executing state transition.
   * if new state update is checkpoint property, client can discard past data.
   * @param block new block submitted to commitment contract
   */
  private async handleNewBlock(block: Block) {
    // TODO: implement
  }

  /**
   * Deposit given amount of given ERC20Contract's token to corresponding deposit contract.
   * @param amount amount to deposit
   * @param erc20ContractAddress ERC20 token address, undefined for ETH
   */
  public async deposit(amount: number, erc20ContractAddress?: Address) {
    const depositContract = this.getDepositContract(
      erc20ContractAddress || ETH_ADDRESS
    )
    const tokenContract = this.getTokenContract(
      erc20ContractAddress || ETH_ADDRESS
    )

    console.log('deposit: ', depositContract, tokenContract)
    if (!depositContract || !tokenContract) {
      throw new Error('Contract not found.')
    }

    const myAddress = this.wallet.getAddress()
    await tokenContract.approve(depositContract.address, Integer.from(amount))

    // TODO: how to handle result
    await depositContract.deposit(
      Integer.from(amount),
      ownershipProperty(myAddress)
    )
  }

  /**
   * transfer token to new owner. throw if given invalid inputs.
   * @param amount amount to transfer
   * @param depositContractAddress which token to transfer
   * @param to to whom transfer
   */
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

    const sig = await this.wallet.signMessage(Coder.encode(tx.body))
    tx.signature = sig

    const res = await axios.post(`${process.env.AGGREGATOR_HOST}/send_tx`, {
      data: Coder.encode(tx.toStruct()).toHexString()
    })

    if (res.status === 201) {
      console.log('successfully deposited to contract')
    } else {
      throw new Error(
        `status: ${res.status}, transaction could not be accepted`
      )
    }
  }

  /**
   * search coin range
   * @param amount search range with greater than this amount
   * @param depositContractAddress search this depositContractAddress
   */
  private async searchRange(
    amount: number,
    depositContractAddress: Address
  ): Promise<StateUpdate | undefined> {
    const db = await this.getStateDb(depositContractAddress)
    const stateUpdates = await db.get(0n, 10000n)
    return stateUpdates
      .map(StateUpdate.fromRangeRecord)
      .find(su => su.amount > BigInt(amount))
  }

  /**
   * given ERC20 deposit contract address, returns corresponding deposit contract.
   * @param erc20ContractAddress ERC20 contract address
   */
  private getDepositContract(
    erc20ContractAddress: Address
  ): IDepositContract | undefined {
    return this.depositContracts.get(erc20ContractAddress.data)
  }

  /**
   * given ERC20 deposit contract address, returns ERC20 contract instance.
   * @param erc20ContractAddress ERC20 contract address
   */
  private getTokenContract(
    erc20ContractAddress: Address
  ): IERC20Contract | undefined {
    return this.tokenContracts.get(erc20ContractAddress.data)
  }

  /**
   * register new ERC20 token
   * @param erc20ContractAddress ERC20 token address to register
   * @param depositContractAddress deposit contract address connecting to tokenAddress above
   */
  public registerToken(
    erc20ContractAddress: Address,
    depositContractAddress: Address
  ) {
    console.log('contracts set for token:', erc20ContractAddress.data)
    const depositContract = this.depositContractFactory(depositContractAddress)
    this.depositContracts.set(depositContractAddress.data, depositContract)
    this.depositContracts.set(erc20ContractAddress.data, depositContract)
    this.tokenContracts.set(
      erc20ContractAddress.data,
      this.tokenContractFactory(erc20ContractAddress)
    )
  }

  /**
   * get range db which stores state updates of given deposit contract address
   * @param depositContractAddress Deposit contract address
   */
  private async getStateDb(depositContractAddress: Address): Promise<RangeDb> {
    const stateDb = await this.kvs.bucket(Bytes.fromString('state'))
    const bucket = await stateDb.bucket(
      Bytes.fromHexString(depositContractAddress.data)
    )
    return new RangeDb(bucket)
  }

  public async exit(amount: number, depositContractAddress: Address) {
    // TODO: implement
  }

  public async finalizeExit(exitId: string) {
    // TODO: implement
  }
}
