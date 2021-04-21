import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import HubdaoFactory from '@hubdao/core/build/HubdaoFactory.json'
import IHubdaoPair from '@hubdao/core/build/IHubdaoPair.json'

import ERC20 from '../../build/ERC20.json'
import WHT9 from '../../build/WHT9.json'
import UniswapV1Exchange from '../../build/UniswapV1Exchange.json'
import UniswapV1Factory from '../../build/UniswapV1Factory.json'
import HubdaoRouter01 from '../../build/HubdaoRouter01.json'
import HubdaoMigrator from '../../build/HubdaoMigrator.json'
import HubdaoRouter02 from '../../build/HubdaoRouter02.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'

const overrides = {
  gasLimit: 9999999
}

interface V2Fixture {
  token0: Contract
  token1: Contract
  WHT: Contract
  WHTPartner: Contract
  factoryV1: Contract
  factoryV2: Contract
  router01: Contract
  router02: Contract
  routerEventEmitter: Contract
  router: Contract
  migrator: Contract
  WHTExchangeV1: Contract
  pair: Contract
  WHTPair: Contract
}

export async function v2Fixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<V2Fixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WHT = await deployContract(wallet, WHT9)
  const WHTPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy V1
  const factoryV1 = await deployContract(wallet, UniswapV1Factory, [])
  await factoryV1.initializeFactory((await deployContract(wallet, UniswapV1Exchange, [])).address)

  // deploy V2
  const factoryV2 = await deployContract(wallet, HubdaoFactory, [wallet.address])

  // deploy routers
  const router01 = await deployContract(wallet, HubdaoRouter01, [factoryV2.address, WHT.address], overrides)
  const router02 = await deployContract(wallet, HubdaoRouter02, [factoryV2.address, WHT.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // deploy migrator
  const migrator = await deployContract(wallet, HubdaoMigrator, [factoryV1.address, router01.address], overrides)

  // initialize V1
  await factoryV1.createExchange(WHTPartner.address, overrides)
  const WHTExchangeV1Address = await factoryV1.getExchange(WHTPartner.address)
  const WHTExchangeV1 = new Contract(WHTExchangeV1Address, JSON.stringify(UniswapV1Exchange.abi), provider).connect(
    wallet
  )

  // initialize V2
  await factoryV2.createPair(tokenA.address, tokenB.address)
  const pairAddress = await factoryV2.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IHubdaoPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await factoryV2.createPair(WHT.address, WHTPartner.address)
  const WHTPairAddress = await factoryV2.getPair(WHT.address, WHTPartner.address)
  const WHTPair = new Contract(WHTPairAddress, JSON.stringify(IHubdaoPair.abi), provider).connect(wallet)

  return {
    token0,
    token1,
    WHT,
    WHTPartner,
    factoryV1,
    factoryV2,
    router01,
    router02,
    router: router02, // the default router, 01 had a minor bug
    routerEventEmitter,
    migrator,
    WHTExchangeV1,
    pair,
    WHTPair
  }
}
