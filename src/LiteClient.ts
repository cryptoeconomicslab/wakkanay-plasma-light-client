import { db } from 'wakkanay'
import { Address, Bytes, Integer } from 'wakkanay/dist/types'
import { IWallet } from 'wakkanay/dist/wallet'
import { FreeVariable } from 'wakkanay/dist/ovm'
import { DepositContract } from 'wakkanay-ethereum/dist/contract'
import { IDepositContract, IERC20Contract } from 'wakkanay/dist/contract'
import { config } from 'dotenv'
import { Property } from 'wakkanay/dist/ovm'
import Coder from 'wakkanay-ethereum/dist/coder'
config()

const DEPOSIT_CONTRACT_ADDRESS = Address.from(
  process.env.DEPOSIT_CONTRACT_ADDRESS as string
)
const ETH_ADDRESS = Address.from(process.env.ETH_ADDRESS as string)
const THERE_EXISTS_ADDRESS = Address.from(
  process.env.THERE_EXISTS_ADDRESS ||
    '0x0000000000000000000500000000000000000005'
)
const IS_VALID_SIGNATURE_ADDRESS = Address.from(
  process.env.IS_VALID_SIGNATURE_ADDRESS ||
    '0x0000000000000000000600000000000000000006'
)

// TODO: extract and use compiled property
function ownershipProperty(from: Address) {
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
            Coder.encode(from),
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

  public init() {
    console.log('Initialize lite client')
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
