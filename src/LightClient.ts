import { Address, Bytes, Integer, Range, BigNumber } from 'wakkanay/dist/types'
import { IWallet } from 'wakkanay/dist/wallet'
import { FreeVariable } from 'wakkanay/dist/ovm'
import { DepositContract, PETHContract } from 'wakkanay-ethereum/dist/contract'
import { EthWallet } from 'wakkanay-ethereum/dist/wallet'
import {
  IDepositContract,
  IERC20Contract,
  ICommitmentContract
} from 'wakkanay/dist/contract'
import { Property } from 'wakkanay/dist/ovm'
import Coder from './Coder'
import { KeyValueStore } from 'wakkanay/dist/db'
import {
  StateUpdate,
  Transaction,
  TransactionReceipt,
  Checkpoint
} from 'wakkanay-ethereum-plasma'
import axios from 'axios'
import { DecoderUtil } from 'wakkanay/dist/utils'
import { StateManager, SyncManager, CheckpointManager } from './managers'
import { DoubleLayerInclusionProof } from 'wakkanay/dist/verifiers'
import { verifiers } from 'wakkanay'

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

export default class LightClient {
  private depositContracts: Map<string, IDepositContract> = new Map()
  private tokenContracts: Map<string, IERC20Contract> = new Map()
  private _syncing = false

  constructor(
    private wallet: IWallet,
    private kvs: KeyValueStore,
    private depositContractFactory: (address: Address) => DepositContract,
    private tokenContractFactory: (address: Address) => IERC20Contract,
    private commitmentContract: ICommitmentContract,
    private stateManager: StateManager,
    private syncManager: SyncManager,
    private checkpointManager: CheckpointManager
  ) {
    this.registerPethContract(ETH_ADDRESS, DEPOSIT_CONTRACT_ADDRESS)
  }

  public get address(): string {
    return this.wallet.getAddress().data
  }

  public get syncing(): boolean {
    return this.syncing
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
      const data = await this.stateManager.getVerifiedStateUpdates(
        Address.from(addr),
        new Range(BigNumber.from(0), BigNumber.from(10000)) // TODO: get all stateUpdate method
      )
      return {
        tokenAddress: addr,
        amount: data.reduce((p, s) => p + Number(s.amount), 0)
      }
    })
    return await Promise.all(resultPromise)
  }

  /**
   * start LiteClient process.
   */
  public async start() {
    this.commitmentContract.subscribeBlockSubmitted((blockNumber, root) => {
      console.log('new block submitted event:', root.toHexString())
      this.syncState(blockNumber, root)
      this.verifyPendingStateUpdates(blockNumber)
    })
    const blockNumber = await this.commitmentContract.getCurrentBlock()
    await this.syncStateUntill(blockNumber)
  }

  /**
   * sync local state to given block number
   * @param blockNum block number to which client should sync
   */
  private async syncStateUntill(blockNum: BigNumber): Promise<void> {
    let synced = await this.syncManager.getLatestSyncedBlockNumber()
    console.log(`sync state from ${synced} to ${blockNum}`)
    if (synced.data > blockNum.data) {
      throw new Error('Synced state is greater than latest block')
    }

    while (synced.data !== blockNum.data) {
      synced = BigNumber.from(synced.data + BigInt(1))
      const root = await this.commitmentContract.getRoot(synced)
      if (!root) {
        // FIXME: check if root is default bytes32 value
        throw new Error('Block root hash is null')
      }
      await this.syncState(synced, root)
    }
  }

  /**
   * fetch latest state from aggregator
   * update local database with new state updates.
   * @param blockNumber block number to sync state
   * @param root root hash of new block to be synced
   */
  private async syncState(blockNumber: BigNumber, root: Bytes) {
    this._syncing = true
    console.log(`syncing state: ${blockNumber}`)
    try {
      const res = await axios.get(
        `${process.env.AGGREGATOR_HOST}/sync_state?address=${this.address}&blockNumber=${blockNumber.data}`
      )
      const stateUpdates: StateUpdate[] = res.data.map(
        (s: string) =>
          new StateUpdate(
            DecoderUtil.decodeStructable(
              Property,
              Coder,
              Bytes.fromHexString(s)
            )
          )
      )
      const promises = stateUpdates.map(async su => {
        // TODO: insert into unverified state update.
        // await this.stateManager.insertUnverifiedStateUpdate(
        await this.stateManager.insertVerifiedStateUpdate(
          su.depositContractAddress,
          su
        )
      })
      await Promise.all(promises)
      await this.syncManager.updateSyncedBlockNumber(blockNumber, root)
      // TODO: fetch history proofs for unverified state update and verify them.
    } catch (e) {
      console.log(e)
    } finally {
      this._syncing = false
    }
  }

  private async verifyPendingStateUpdates(blockNumber: BigNumber) {
    console.group('VERIFY PENDING STATE UPDATES: ', blockNumber)
    Object.keys(this.depositContracts).forEach(async addr => {
      const pendingStateUpdates = await this.stateManager.getPendingStateUpdates(
        Address.from(addr),
        new Range(BigNumber.from(0), BigNumber.from(10000n))
      )
      const verifier = new verifiers.DoubleLayerTreeVerifier()
      const root = await this.syncManager.getRoot(blockNumber)
      if (!root) {
        return
      }

      pendingStateUpdates.forEach(async su => {
        console.info(
          `Verify pended state update: (${su.range.start.data.toString()}, ${su.range.end.data.toString()})`
        )
        const res = await axios.get(
          `${
            process.env.AGGREGATOR_HOST
          }/inclusion_proof?blockNumber=${su.blockNumber.toString()}&stateUpdate=${Coder.encode(
            su.property.toStruct()
          ).toHexString()}`
        )
        if (res.status === 404) {
          return
        }
        const inclusionProof = DecoderUtil.decodeStructable(
          DoubleLayerInclusionProof,
          Coder,
          Bytes.fromHexString(res.data.data)
        )
        const leaf = new verifiers.DoubleLayerTreeLeaf(
          su.depositContractAddress,
          su.range.start,
          verifiers.Keccak256.hash(Coder.encode(su.property.toStruct()))
        )
        if (verifier.verifyInclusion(leaf, su.range, root, inclusionProof)) {
          console.info(
            `Pended state update (${su.range.start.data.toString()}, ${su.range.end.data.toString()}) verified. remove from stateDB`
          )
          await this.stateManager.removePendingStateUpdate(
            su.depositContractAddress,
            su.range
          )
        }
      })
    })
    console.groupEnd()
  }

  /**
   * Deposit given amount of given ERC20Contract's token to corresponding deposit contract.
   * @param amount amount to deposit
   * @param erc20ContractAddress ERC20 token address, undefined for ETH
   */
  public async deposit(amount: number, erc20ContractAddress?: Address) {
    const myAddress = this.wallet.getAddress()

    if (!erc20ContractAddress) {
      const depositContract = this.getDepositContract(
        DEPOSIT_CONTRACT_ADDRESS
      ) as DepositContract
      const tokenContract = this.getTokenContract(
        DEPOSIT_CONTRACT_ADDRESS
      ) as PETHContract
      await tokenContract.wrap(amount.toString())
      await tokenContract.approve(depositContract.address, Integer.from(amount))
      await depositContract.deposit(
        Integer.from(amount),
        ownershipProperty(myAddress)
      )

      return
    }

    const depositContract = this.getDepositContract(erc20ContractAddress)
    const tokenContract = this.getTokenContract(erc20ContractAddress)
    console.log('deposit: ', depositContract, tokenContract)
    if (!depositContract || !tokenContract) {
      throw new Error('Contract not found.')
    }

    await tokenContract.approve(depositContract.address, Integer.from(amount))
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
    const su = await this.stateManager.resolveStateUpdate(
      depositContractAddress,
      amount
    )
    if (!su) {
      throw new Error('Not enough amount')
    }

    const property = ownershipProperty(to)
    const tx = new Transaction(
      depositContractAddress,
      new Range(
        su.range.start,
        BigNumber.from(su.range.start.data + BigInt(amount))
      ),
      property,
      this.wallet.getAddress()
    )

    const sig = await this.wallet.signMessage(Coder.encode(tx.body))
    tx.signature = sig

    const res = await axios.post(`${process.env.AGGREGATOR_HOST}/send_tx`, {
      data: Coder.encode(tx.toStruct()).toHexString()
    })

    if (res.data) {
      const receipt = DecoderUtil.decodeStructable(
        TransactionReceipt,
        Coder,
        Bytes.fromHexString(res.data)
      )
      console.log(receipt)
      if (receipt.status.data === 1) {
        await this.stateManager.removeVerifiedStateUpdate(
          su.depositContractAddress,
          su.range
        )
        await this.stateManager.insertPendingStateUpdate(
          su.depositContractAddress,
          su
        )
      } else {
        throw new Error('Invalid transaction')
      }
    }
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

  private registerPethContract(
    pethContractAddress: Address,
    depositContractAddress: Address
  ) {
    const depositContract = this.depositContractFactory(depositContractAddress)
    this.depositContracts.set(depositContractAddress.data, depositContract)
    this.tokenContracts.set(
      depositContractAddress.data,
      new PETHContract(
        pethContractAddress,
        (this.wallet as EthWallet).getEthersWallet()
      )
    )

    depositContract.subscribeCheckpointFinalized(
      (checkpointId: Bytes, checkpoint: [Range, Property]) => {
        const c = new Checkpoint(checkpoint[0], checkpoint[1])
        this.checkpointManager.insertCheckpoint(
          depositContractAddress,
          checkpointId,
          c
        )

        const stateUpdate = new StateUpdate(checkpoint[1])
        const owner = stateUpdate.getOwner()
        if (owner && owner.data === this.wallet.getAddress().data) {
          this.stateManager.insertVerifiedStateUpdate(
            depositContractAddress,
            stateUpdate
          )
        }
      }
    )
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
    this.tokenContracts.set(
      depositContractAddress.data,
      this.tokenContractFactory(erc20ContractAddress)
    )

    depositContract.subscribeCheckpointFinalized(
      (checkpointId: Bytes, checkpoint: [Range, Property]) => {
        const c = new Checkpoint(checkpoint[0], checkpoint[1])
        this.checkpointManager.insertCheckpoint(
          depositContractAddress,
          checkpointId,
          c
        )

        const stateUpdate = new StateUpdate(checkpoint[1])
        const owner = stateUpdate.getOwner()
        if (owner && owner.data === this.wallet.getAddress().data) {
          this.stateManager.insertVerifiedStateUpdate(
            depositContractAddress,
            stateUpdate
          )
        }
      }
    )
  }

  public async exit(amount: number, depositContractAddress: Address) {
    // TODO: implement
  }

  public async finalizeExit(exitId: string) {
    // TODO: implement
  }
}
