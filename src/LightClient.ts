import {
  StateUpdate,
  Transaction,
  TransactionReceipt,
  Checkpoint
} from '@cryptoeconomicslab/plasma'
import {
  Property,
  CompiledPredicate,
  DeciderManager,
  InitilizationConfig
} from '@cryptoeconomicslab/ovm'
import {
  Address,
  Bytes,
  BigNumber,
  Integer,
  Range
} from '@cryptoeconomicslab/primitives'
import { KeyValueStore } from '@cryptoeconomicslab/db'
import {
  ICommitmentContract,
  IDepositContract,
  IERC20Contract,
  IAdjudicationContract
} from '@cryptoeconomicslab/contract'
import { PETHContract, DepositContract } from '@cryptoeconomicslab/eth-contract'
import { Wallet } from '@cryptoeconomicslab/wallet'
import { decodeStructable } from '@cryptoeconomicslab/coder'
import { EthWallet } from '@cryptoeconomicslab/eth-wallet'
import {
  DoubleLayerInclusionProof,
  DoubleLayerTreeVerifier,
  DoubleLayerTreeLeaf
} from '@cryptoeconomicslab/merkle-tree'
import { Keccak256 } from '@cryptoeconomicslab/hash'

import EventEmitter from 'event-emitter'
import { StateManager, SyncManager, CheckpointManager } from './managers'
import APIClient from './APIClient'

const DEPOSIT_CONTRACT_ADDRESS = Address.from(
  process.env.DEPOSIT_CONTRACT_ADDRESS as string
)
const ETH_ADDRESS = Address.from(process.env.ETH_ADDRESS as string)

enum EmitterEvent {
  CHECKPOINT_FINALIZED = 'CHECKPOINT_FINALIZED',
  TRANSFER_COMPLETE = 'TRANSFER_COMPLETE',
  SYNC_FINISHED = 'SYNC_FINISHED',
  EXIT_FINALIZED = 'EXIT_FINALIZED'
}

export default class LightClient {
  private depositContracts: Map<string, IDepositContract> = new Map()
  private tokenContracts: Map<string, IERC20Contract> = new Map()
  private _syncing = false
  private ee = EventEmitter()
  private ownershipPredicate: CompiledPredicate
  private deciderManager: DeciderManager

  constructor(
    private wallet: Wallet,
    private witnessDb: KeyValueStore,
    private adjudicationContract: IAdjudicationContract,
    private depositContractFactory: (address: Address) => DepositContract,
    private tokenContractFactory: (address: Address) => IERC20Contract,
    private commitmentContract: ICommitmentContract,
    private stateManager: StateManager,
    private syncManager: SyncManager,
    private checkpointManager: CheckpointManager,
    config: InitilizationConfig
  ) {
    this.deciderManager = new DeciderManager(witnessDb, ovmContext.coder)
    this.deciderManager.loadJson(config)
    const ownershipPredicate = this.deciderManager.compiledPredicateMap.get(
      'Ownership'
    )
    if (ownershipPredicate === undefined) {
      throw new Error('Ownership not found')
    }
    this.ownershipPredicate = ownershipPredicate
    this.registerPethContract(ETH_ADDRESS, DEPOSIT_CONTRACT_ADDRESS)
  }

  public ownershipProperty(owner: Address): Property {
    return this.ownershipPredicate.makeProperty([
      Bytes.fromHexString(owner.data)
    ])
  }

  public getOwner(stateUpdate: StateUpdate): Address {
    return Address.from(stateUpdate.stateObject.inputs[0].toHexString())
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
      const res = await APIClient.syncState(this.address, blockNumber)
      const stateUpdates: StateUpdate[] = res.data.map((s: string) =>
        StateUpdate.fromProperty(
          decodeStructable(Property, ovmContext.coder, Bytes.fromHexString(s))
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
      this.ee.emit(EmitterEvent.SYNC_FINISHED, blockNumber)
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
        new Range(BigNumber.from(0), BigNumber.from(BigInt(10000)))
      )
      const verifier = new DoubleLayerTreeVerifier()
      const root = await this.syncManager.getRoot(blockNumber)
      if (!root) {
        return
      }

      pendingStateUpdates.forEach(async su => {
        console.info(
          `Verify pended state update: (${su.range.start.data.toString()}, ${su.range.end.data.toString()})`
        )
        const res = await APIClient.inclusionProof(su)
        if (res.status === 404) {
          return
        }
        const inclusionProof = decodeStructable(
          DoubleLayerInclusionProof,
          ovmContext.coder,
          Bytes.fromHexString(res.data.data)
        )
        const leaf = new DoubleLayerTreeLeaf(
          su.depositContractAddress,
          su.range.start,
          Keccak256.hash(ovmContext.coder.encode(su.property.toStruct()))
        )
        if (verifier.verifyInclusion(leaf, su.range, root, inclusionProof)) {
          console.info(
            `Pended state update (${su.range.start.data.toString()}, ${su.range.end.data.toString()}) verified. remove from stateDB`
          )
          await this.stateManager.removePendingStateUpdate(
            su.depositContractAddress,
            su.range
          )

          // store inclusionProof as witness
          await (
            await this.witnessDb.bucket(Bytes.fromString('inclusion_proof'))
          ).put(
            Bytes.fromString('TODO: use su range as a key'),
            Bytes.fromHexString(res.data.data)
          )
          this.ee.emit(EmitterEvent.TRANSFER_COMPLETE, su)
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
        this.ownershipProperty(myAddress)
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
      this.ownershipProperty(myAddress)
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
    const stateUpdates = await this.stateManager.resolveStateUpdate(
      depositContractAddress,
      amount
    )
    if (stateUpdates === null) {
      throw new Error('Not enough amount')
    }

    const property = this.ownershipProperty(to)
    const latestBlock = await this.syncManager.getLatestSyncedBlockNumber()
    const transactions = await Promise.all(
      stateUpdates.map(async su => {
        const tx = new Transaction(
          depositContractAddress,
          su.range,
          BigNumber.from(latestBlock.data + BigInt(5)),
          property,
          this.wallet.getAddress()
        )
        const sig = await this.wallet.signMessage(
          ovmContext.coder.encode(tx.toProperty(Address.default()).toStruct())
        )
        tx.signature = sig
        return tx
      })
    )

    const res = await APIClient.sendTransaction(transactions)

    if (Array.isArray(res.data)) {
      const receipts = res.data.map(d => {
        return decodeStructable(
          TransactionReceipt,
          ovmContext.coder,
          Bytes.fromHexString(d)
        )
      })

      // TODO: is this valid handling?
      for await (const receipt of receipts) {
        if (receipt.status.data === 1) {
          for await (const su of stateUpdates) {
            await this.stateManager.removeVerifiedStateUpdate(
              su.depositContractAddress,
              su.range
            )
            await this.stateManager.insertPendingStateUpdate(
              su.depositContractAddress,
              su
            )
          }
        } else {
          throw new Error('Invalid transaction')
        }
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
      async (checkpointId: Bytes, checkpoint: [Range, Property]) => {
        const c = new Checkpoint(checkpoint[0], checkpoint[1])
        await this.checkpointManager.insertCheckpoint(
          depositContractAddress,
          checkpointId,
          c
        )

        const stateUpdate = StateUpdate.fromProperty(checkpoint[1])
        const owner = this.getOwner(stateUpdate)
        if (owner && owner.data === this.wallet.getAddress().data) {
          await this.stateManager.insertVerifiedStateUpdate(
            depositContractAddress,
            stateUpdate
          )
        }

        this.ee.emit(
          EmitterEvent.CHECKPOINT_FINALIZED,
          checkpointId,
          checkpoint
        )
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
      async (checkpointId: Bytes, checkpoint: [Range, Property]) => {
        const c = new Checkpoint(checkpoint[0], checkpoint[1])
        await this.checkpointManager.insertCheckpoint(
          depositContractAddress,
          checkpointId,
          c
        )

        const stateUpdate = StateUpdate.fromProperty(checkpoint[1])
        const owner = this.getOwner(stateUpdate)
        if (owner && owner.data === this.wallet.getAddress().data) {
          await this.stateManager.insertVerifiedStateUpdate(
            depositContractAddress,
            stateUpdate
          )
        }
        this.ee.emit(
          EmitterEvent.CHECKPOINT_FINALIZED,
          checkpointId,
          checkpoint
        )
      }
    )
  }

  public async exit(amount: number, depositContractAddress: Address) {
    const stateUpdates = await this.stateManager.resolveStateUpdate(
      depositContractAddress,
      amount
    )
    if (Array.isArray(stateUpdates) && stateUpdates.length > 0) {
      const predicate = this.deciderManager.compiledPredicateMap.get('Exit')
      if (!predicate) throw new Error('Exit predicate not found')
      const coder = ovmContext.coder
      await Promise.all(
        stateUpdates.map(async stateUpdate => {
          const proof = await (
            await this.witnessDb.bucket(Bytes.fromString('inclusion_proof'))
          ).get(Bytes.fromString('TODO: use su range as a key'))
          if (!proof)
            throw new Error('No inclusion proof for state update is found')

          const exitProperty = predicate.makeProperty([
            coder.encode(stateUpdate.property.toStruct()),
            proof
          ])
          const exitId = Keccak256.hash(coder.encode(exitProperty.toStruct()))
          await this.adjudicationContract.claimProperty(exitProperty)
          await (await this.witnessDb.bucket(Bytes.fromString('Exit'))).put(
            exitId,
            coder.encode(exitProperty.toStruct())
          )
        })
      )
    }
  }

  public async finalizeExit(exitId: Bytes) {
    // TODO: implement
    // get exit lists
    // if a exit with given id is finalizable,
    // call finalize exit method on deposit contract.

    {
      this.ee.emit(EmitterEvent.EXIT_FINALIZED, exitId)
    }
  }

  // TODO: handling challenge game

  //
  // Events subscriptions
  //

  public subscribeCheckpointFinalized(
    handler: (checkpointId: Bytes, checkpoint: [Range, Property]) => void
  ) {
    this.ee.on(EmitterEvent.CHECKPOINT_FINALIZED, handler)
  }

  public subscribeSyncFinished(handler: (blockNumber: BigNumber) => void) {
    this.ee.on(EmitterEvent.SYNC_FINISHED, handler)
  }

  public subscribeTransferComplete(handler: (su: StateUpdate) => void) {
    this.ee.on(EmitterEvent.TRANSFER_COMPLETE, handler)
  }

  public subscribeExitFinalized(handler: (exitId: Bytes) => void) {
    this.ee.on(EmitterEvent.EXIT_FINALIZED, handler)
  }

  public unsubscribeCheckpointFinalized(
    handler: (checkpointId: Bytes, checkpoint: [Range, Property]) => void
  ) {
    this.ee.off(EmitterEvent.CHECKPOINT_FINALIZED, handler)
  }

  public unsubscribeSyncFinished(handler: (blockNumber: BigNumber) => void) {
    this.ee.off(EmitterEvent.SYNC_FINISHED, handler)
  }

  public unsubscribeTransferComplete(handler: (su: StateUpdate) => void) {
    this.ee.off(EmitterEvent.TRANSFER_COMPLETE, handler)
  }

  public unsubscribeExitFinalized(handler: (exitId: Bytes) => void) {
    this.ee.off(EmitterEvent.EXIT_FINALIZED, handler)
  }
}
