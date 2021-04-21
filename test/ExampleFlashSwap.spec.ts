import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, defaultAbiCoder, formatEther } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

import ExampleFlashSwap from '../build/ExampleFlashSwap.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
  gasPrice: 0
}

describe('ExampleFlashSwap', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WHT: Contract
  let WHTPartner: Contract
  let WHTExchangeV1: Contract
  let WHTPair: Contract
  let flashSwapExample: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)

    WHT = fixture.WHT
    WHTPartner = fixture.WHTPartner
    WHTExchangeV1 = fixture.WHTExchangeV1
    WHTPair = fixture.WHTPair
    flashSwapExample = await deployContract(
      wallet,
      ExampleFlashSwap,
      [fixture.factoryV2.address, fixture.factoryV1.address, fixture.router.address],
      overrides
    )
  })

  it('uniswapV2Call:0', async () => {
    // add liquidity to V1 at a rate of 1 HT / 200 X
    const WHTPartnerAmountV1 = expandTo18Decimals(2000)
    const HTAmountV1 = expandTo18Decimals(10)
    await WHTPartner.approve(WHTExchangeV1.address, WHTPartnerAmountV1)
    await WHTExchangeV1.addLiquidity(bigNumberify(1), WHTPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: HTAmountV1
    })

    // add liquidity to V2 at a rate of 1 HT / 100 X
    const WHTPartnerAmountV2 = expandTo18Decimals(1000)
    const HTAmountV2 = expandTo18Decimals(10)
    await WHTPartner.transfer(WHTPair.address, WHTPartnerAmountV2)
    await WHT.deposit({ value: HTAmountV2 })
    await WHT.transfer(WHTPair.address, HTAmountV2)
    await WHTPair.mint(wallet.address, overrides)

    const balanceBefore = await WHTPartner.balanceOf(wallet.address)

    // now, execute arbitrage via uniswapV2Call:
    // receive 1 HT from V2, get as much X from V1 as we can, repay V2 with minimum X, keep the rest!
    const arbitrageAmount = expandTo18Decimals(1)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WHTPairToken0 = await WHTPair.token0()
    const amount0 = WHTPairToken0 === WHTPartner.address ? bigNumberify(0) : arbitrageAmount
    const amount1 = WHTPairToken0 === WHTPartner.address ? arbitrageAmount : bigNumberify(0)
    await WHTPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await WHTPartner.balanceOf(wallet.address)
    const profit = balanceAfter.sub(balanceBefore).div(expandTo18Decimals(1))
    const reservesV1 = [
      await WHTPartner.balanceOf(WHTExchangeV1.address),
      await provider.getBalance(WHTExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WHTPair.getReserves()).slice(0, 2)
    const priceV2 =
      WHTPairToken0 === WHTPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(profit.toString()).to.eq('69') // our profit is ~69 tokens
    expect(priceV1.toString()).to.eq('165') // we pushed the v1 price down to ~165
    expect(priceV2.toString()).to.eq('123') // we pushed the v2 price up to ~123
  })

  it('uniswapV2Call:1', async () => {
    // add liquidity to V1 at a rate of 1 HT / 100 X
    const WHTPartnerAmountV1 = expandTo18Decimals(1000)
    const HTAmountV1 = expandTo18Decimals(10)
    await WHTPartner.approve(WHTExchangeV1.address, WHTPartnerAmountV1)
    await WHTExchangeV1.addLiquidity(bigNumberify(1), WHTPartnerAmountV1, MaxUint256, {
      ...overrides,
      value: HTAmountV1
    })

    // add liquidity to V2 at a rate of 1 HT / 200 X
    const WHTPartnerAmountV2 = expandTo18Decimals(2000)
    const HTAmountV2 = expandTo18Decimals(10)
    await WHTPartner.transfer(WHTPair.address, WHTPartnerAmountV2)
    await WHT.deposit({ value: HTAmountV2 })
    await WHT.transfer(WHTPair.address, HTAmountV2)
    await WHTPair.mint(wallet.address, overrides)

    const balanceBefore = await provider.getBalance(wallet.address)

    // now, execute arbitrage via uniswapV2Call:
    // receive 200 X from V2, get as much HT from V1 as we can, repay V2 with minimum HT, keep the rest!
    const arbitrageAmount = expandTo18Decimals(200)
    // instead of being 'hard-coded', the above value could be calculated optimally off-chain. this would be
    // better, but it'd be better yet to calculate the amount at runtime, on-chain. unfortunately, this requires a
    // swap-to-price calculation, which is a little tricky, and out of scope for the moment
    const WHTPairToken0 = await WHTPair.token0()
    const amount0 = WHTPairToken0 === WHTPartner.address ? arbitrageAmount : bigNumberify(0)
    const amount1 = WHTPairToken0 === WHTPartner.address ? bigNumberify(0) : arbitrageAmount
    await WHTPair.swap(
      amount0,
      amount1,
      flashSwapExample.address,
      defaultAbiCoder.encode(['uint'], [bigNumberify(1)]),
      overrides
    )

    const balanceAfter = await provider.getBalance(wallet.address)
    const profit = balanceAfter.sub(balanceBefore)
    const reservesV1 = [
      await WHTPartner.balanceOf(WHTExchangeV1.address),
      await provider.getBalance(WHTExchangeV1.address)
    ]
    const priceV1 = reservesV1[0].div(reservesV1[1])
    const reservesV2 = (await WHTPair.getReserves()).slice(0, 2)
    const priceV2 =
      WHTPairToken0 === WHTPartner.address ? reservesV2[0].div(reservesV2[1]) : reservesV2[1].div(reservesV2[0])

    expect(formatEther(profit)).to.eq('0.548043441089763649') // our profit is ~.5 HT
    expect(priceV1.toString()).to.eq('143') // we pushed the v1 price up to ~143
    expect(priceV2.toString()).to.eq('161') // we pushed the v2 price down to ~161
  })
})
