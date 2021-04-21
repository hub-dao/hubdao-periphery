import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { v2Fixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('HubdaoMigrator', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WHTPartner: Contract
  let WHTPair: Contract
  let router: Contract
  let migrator: Contract
  let WHTExchangeV1: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)
    WHTPartner = fixture.WHTPartner
    WHTPair = fixture.WHTPair
    router = fixture.router01 // we used router01 for this contract
    migrator = fixture.migrator
    WHTExchangeV1 = fixture.WHTExchangeV1
  })

  it('migrate', async () => {
    const WHTPartnerAmount = expandTo18Decimals(1)
    const HTAmount = expandTo18Decimals(4)
    await WHTPartner.approve(WHTExchangeV1.address, MaxUint256)
    await WHTExchangeV1.addLiquidity(bigNumberify(1), WHTPartnerAmount, MaxUint256, {
      ...overrides,
      value: HTAmount
    })
    await WHTExchangeV1.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    const WHTPairToken0 = await WHTPair.token0()
    await expect(
      migrator.migrate(WHTPartner.address, WHTPartnerAmount, HTAmount, wallet.address, MaxUint256, overrides)
    )
      .to.emit(WHTPair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(WHTPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(WHTPair, 'Sync')
      .withArgs(
        WHTPairToken0 === WHTPartner.address ? WHTPartnerAmount : HTAmount,
        WHTPairToken0 === WHTPartner.address ? HTAmount : WHTPartnerAmount
      )
      .to.emit(WHTPair, 'Mint')
      .withArgs(
        router.address,
        WHTPairToken0 === WHTPartner.address ? WHTPartnerAmount : HTAmount,
        WHTPairToken0 === WHTPartner.address ? HTAmount : WHTPartnerAmount
      )
    expect(await WHTPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })
})
