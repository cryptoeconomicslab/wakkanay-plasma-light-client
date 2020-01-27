import axios from 'axios'
import { BigNumber } from '@cryptoeconomicslab/primitives'
import { StateUpdate, Transaction } from '@cryptoeconomicslab/plasma'
const API_HOST: string = process.env.AGGREGATOR_HOST

const APIClient = {
  syncState: (address: string, blockNumber: BigNumber) =>
    axios.get(
      `${API_HOST}/sync_state?address=${address}&blockNumber=${blockNumber.data}`
    ),
  inclusionProof: (su: StateUpdate) =>
    axios.get(
      `${API_HOST}/inclusion_proof?blockNumber=${su.blockNumber.toString()}&stateUpdate=${ovmContext.coder
        .encode(su.property.toStruct())
        .toHexString()}`
    ),
  sendTransaction: (tx: Transaction[] | Transaction) => {
    const data = Array.isArray(tx)
      ? tx.map(x => ovmContext.coder.encode(x.toStruct()).toHexString())
      : ovmContext.coder.encode(tx.toStruct()).toHexString()

    return axios.post(`${API_HOST}/send_tx`, {
      data
    })
  }
}

export default APIClient
