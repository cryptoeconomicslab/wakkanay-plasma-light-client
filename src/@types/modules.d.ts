declare namespace NodeJS {
  export interface ProcessEnv {
    MAIN_CHAIN_HOST: string
    AGGREGATOR_HOST: string

    ETH_ADDRESS: string
    TOKEN_ADDRESS: string
    DEPOSIT_CONTRACT_ADDRESS: string
    COMMITMENT_CONTRACT_ADDRESS: string
    UNIVERSAL_ADJUDICATION_CONTRACT_ADDRESS: string
    THERE_EXISTS_ADDRESS: string
    IS_VALID_SIG_ADDRESS: string

    TEST_PRIVATE_KEY: string
  }
}
