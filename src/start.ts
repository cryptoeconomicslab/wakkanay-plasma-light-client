import * as ethers from 'ethers'
import { EthWallet } from 'wakkanay-ethereum/dist/wallet'
import { Address, Bytes } from 'wakkanay/dist/types'
import { InMemoryKeyValueStore } from 'wakkanay/dist/db'
import LiteClient from './LiteClient'
import { DepositContract, ERC20Contract } from 'wakkanay-ethereum/dist/contract'
import { config } from 'dotenv'
config()

async function instantiate() {
  const kvs = new InMemoryKeyValueStore(Bytes.fromString('plasma_aggregator'))
  const eventDb = await kvs.bucket(Bytes.fromString('event'))

  const wallet = new EthWallet(
    new ethers.Wallet(
      process.env.TEST_PRIVATE_KEY as string,
      new ethers.providers.JsonRpcProvider(process.env.MAIN_CHAIN_HOST)
    )
  )

  function depositContractFactory(address: Address) {
    return new DepositContract(address, eventDb, wallet.getEthersWallet())
  }

  function tokenContractFactory(address: Address) {
    return new ERC20Contract(address, wallet.getEthersWallet())
  }

  return new LiteClient(wallet, depositContractFactory, tokenContractFactory)
}

async function main() {
  const liteClient = await instantiate()

  liteClient.registerToken(
    Address.from(process.env.TOKEN_ADDRESS as string),
    Address.from(process.env.DEPOSIT_CONTRACT_ADDRESS as string)
  )

  liteClient.deposit(10, Address.from(process.env.TOKEN_ADDRESS as string))
}

main()
