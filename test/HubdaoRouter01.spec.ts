import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, Zero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { expandTo18Decimals, getApprovalDigest, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { v2Fixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

enum RouterVersion {
  HubdaoRouter01 = 'HubdaoRouter01',
  HubdaoRouter02 = 'HubdaoRouter02'
}

describe('HubdaoRouter{01,02}', () => {
  for (const routerVersion of Object.keys(RouterVersion)) {
    const provider = new MockProvider({
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999
    })
    const [wallet] = provider.getWallets()
    const loadFixture = createFixtureLoader(provider, [wallet])

    let token0: Contract
    let token1: Contract
    let WHT: Contract
    let WHTPartner: Contract
    let factory: Contract
    let router: Contract
    let pair: Contract
    let WHTPair: Contract
    let routerEventEmitter: Contract
    beforeEach(async function() {
      const fixture = await loadFixture(v2Fixture)
      token0 = fixture.token0
      token1 = fixture.token1
      WHT = fixture.WHT
      WHTPartner = fixture.WHTPartner
      factory = fixture.factoryV2
      router = {
        [RouterVersion.HubdaoRouter01]: fixture.router01,
        [RouterVersion.HubdaoRouter02]: fixture.router02
      }[routerVersion as RouterVersion]
      pair = fixture.pair
      WHTPair = fixture.WHTPair
      routerEventEmitter = fixture.routerEventEmitter
    })

    afterEach(async function() {
      expect(await provider.getBalance(router.address)).to.eq(Zero)
    })

    describe(routerVersion, () => {
      it('factory, WHT', async () => {
        expect(await router.factory()).to.eq(factory.address)
        expect(await router.WHT()).to.eq(WHT.address)
      })

      it('addLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        await token0.approve(router.address, MaxUint256)
        await token1.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidity(
            token0.address,
            token1.address,
            token0Amount,
            token1Amount,
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(token0, 'Transfer')
          .withArgs(wallet.address, pair.address, token0Amount)
          .to.emit(token1, 'Transfer')
          .withArgs(wallet.address, pair.address, token1Amount)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
          .to.emit(pair, 'Transfer')
          .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Sync')
          .withArgs(token0Amount, token1Amount)
          .to.emit(pair, 'Mint')
          .withArgs(router.address, token0Amount, token1Amount)

        expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      })

      it('addLiquidityHT', async () => {
        const WHTPartnerAmount = expandTo18Decimals(1)
        const HTAmount = expandTo18Decimals(4)

        const expectedLiquidity = expandTo18Decimals(2)
        const WHTPairToken0 = await WHTPair.token0()
        await WHTPartner.approve(router.address, MaxUint256)
        await expect(
          router.addLiquidityHT(
            WHTPartner.address,
            WHTPartnerAmount,
            WHTPartnerAmount,
            HTAmount,
            wallet.address,
            MaxUint256,
            { ...overrides, value: HTAmount }
          )
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

      async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
        await token0.transfer(pair.address, token0Amount)
        await token1.transfer(pair.address, token1Amount)
        await pair.mint(wallet.address, overrides)
      }
      it('removeLiquidity', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)
        await pair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidity(
            token0.address,
            token1.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(pair, 'Transfer')
          .withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(pair, 'Transfer')
          .withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(token0, 'Transfer')
          .withArgs(pair.address, wallet.address, token0Amount.sub(500))
          .to.emit(token1, 'Transfer')
          .withArgs(pair.address, wallet.address, token1Amount.sub(2000))
          .to.emit(pair, 'Sync')
          .withArgs(500, 2000)
          .to.emit(pair, 'Burn')
          .withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

        expect(await pair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyToken0 = await token0.totalSupply()
        const totalSupplyToken1 = await token1.totalSupply()
        expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
        expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
      })

      it('removeLiquidityHT', async () => {
        const WHTPartnerAmount = expandTo18Decimals(1)
        const HTAmount = expandTo18Decimals(4)
        await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
        await WHT.deposit({ value: HTAmount })
        await WHT.transfer(WHTPair.address, HTAmount)
        await WHTPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)
        const WHTPairToken0 = await WHTPair.token0()
        await WHTPair.approve(router.address, MaxUint256)
        await expect(
          router.removeLiquidityHT(
            WHTPartner.address,
            expectedLiquidity.sub(MINIMUM_LIQUIDITY),
            0,
            0,
            wallet.address,
            MaxUint256,
            overrides
          )
        )
          .to.emit(WHTPair, 'Transfer')
          .withArgs(wallet.address, WHTPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WHTPair, 'Transfer')
          .withArgs(WHTPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
          .to.emit(WHT, 'Transfer')
          .withArgs(WHTPair.address, router.address, HTAmount.sub(2000))
          .to.emit(WHTPartner, 'Transfer')
          .withArgs(WHTPair.address, router.address, WHTPartnerAmount.sub(500))
          .to.emit(WHTPartner, 'Transfer')
          .withArgs(router.address, wallet.address, WHTPartnerAmount.sub(500))
          .to.emit(WHTPair, 'Sync')
          .withArgs(
            WHTPairToken0 === WHTPartner.address ? 500 : 2000,
            WHTPairToken0 === WHTPartner.address ? 2000 : 500
          )
          .to.emit(WHTPair, 'Burn')
          .withArgs(
            router.address,
            WHTPairToken0 === WHTPartner.address ? WHTPartnerAmount.sub(500) : HTAmount.sub(2000),
            WHTPairToken0 === WHTPartner.address ? HTAmount.sub(2000) : WHTPartnerAmount.sub(500),
            router.address
          )

        expect(await WHTPair.balanceOf(wallet.address)).to.eq(0)
        const totalSupplyWHTPartner = await WHTPartner.totalSupply()
        const totalSupplyWHT = await WHT.totalSupply()
        expect(await WHTPartner.balanceOf(wallet.address)).to.eq(totalSupplyWHTPartner.sub(500))
        expect(await WHT.balanceOf(wallet.address)).to.eq(totalSupplyWHT.sub(2000))
      })

      it('removeLiquidityWithPermit', async () => {
        const token0Amount = expandTo18Decimals(1)
        const token1Amount = expandTo18Decimals(4)
        await addLiquidity(token0Amount, token1Amount)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await pair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          pair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityWithPermit(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      it('removeLiquidityHTWithPermit', async () => {
        const WHTPartnerAmount = expandTo18Decimals(1)
        const HTAmount = expandTo18Decimals(4)
        await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
        await WHT.deposit({ value: HTAmount })
        await WHT.transfer(WHTPair.address, HTAmount)
        await WHTPair.mint(wallet.address, overrides)

        const expectedLiquidity = expandTo18Decimals(2)

        const nonce = await WHTPair.nonces(wallet.address)
        const digest = await getApprovalDigest(
          WHTPair,
          { owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY) },
          nonce,
          MaxUint256
        )

        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

        await router.removeLiquidityHTWithPermit(
          WHTPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          0,
          0,
          wallet.address,
          MaxUint256,
          false,
          v,
          r,
          s,
          overrides
        )
      })

      describe('swapExactTokensForTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          await expect(
            router.swapExactTokensForTokens(
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, swapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, expectedOutputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForTokens(
              router.address,
              swapAmount,
              0,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          await token0.approve(router.address, MaxUint256)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactTokensForTokens(
            swapAmount,
            0,
            [token0.address, token1.address],
            wallet.address,
            MaxUint256,
            overrides
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.HubdaoRouter01]: 101854,
              [RouterVersion.HubdaoRouter02]: 101898
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactTokens', () => {
        const token0Amount = expandTo18Decimals(5)
        const token1Amount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await addLiquidity(token0Amount, token1Amount)
        })

        it('happy path', async () => {
          await token0.approve(router.address, MaxUint256)
          await expect(
            router.swapTokensForExactTokens(
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(token0, 'Transfer')
            .withArgs(wallet.address, pair.address, expectedSwapAmount)
            .to.emit(token1, 'Transfer')
            .withArgs(pair.address, wallet.address, outputAmount)
            .to.emit(pair, 'Sync')
            .withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
            .to.emit(pair, 'Swap')
            .withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
        })

        it('amounts', async () => {
          await token0.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactTokens(
              router.address,
              outputAmount,
              MaxUint256,
              [token0.address, token1.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactHTForTokens', () => {
        const WHTPartnerAmount = expandTo18Decimals(10)
        const HTAmount = expandTo18Decimals(5)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
          await WHT.deposit({ value: HTAmount })
          await WHT.transfer(WHTPair.address, HTAmount)
          await WHTPair.mint(wallet.address, overrides)

          await token0.approve(router.address, MaxUint256)
        })

        it('happy path', async () => {
          const WHTPairToken0 = await WHTPair.token0()
          await expect(
            router.swapExactHTForTokens(0, [WHT.address, WHTPartner.address], wallet.address, MaxUint256, {
              ...overrides,
              value: swapAmount
            })
          )
            .to.emit(WHT, 'Transfer')
            .withArgs(router.address, WHTPair.address, swapAmount)
            .to.emit(WHTPartner, 'Transfer')
            .withArgs(WHTPair.address, wallet.address, expectedOutputAmount)
            .to.emit(WHTPair, 'Sync')
            .withArgs(
              WHTPairToken0 === WHTPartner.address
                ? WHTPartnerAmount.sub(expectedOutputAmount)
                : HTAmount.add(swapAmount),
              WHTPairToken0 === WHTPartner.address
                ? HTAmount.add(swapAmount)
                : WHTPartnerAmount.sub(expectedOutputAmount)
            )
            .to.emit(WHTPair, 'Swap')
            .withArgs(
              router.address,
              WHTPairToken0 === WHTPartner.address ? 0 : swapAmount,
              WHTPairToken0 === WHTPartner.address ? swapAmount : 0,
              WHTPairToken0 === WHTPartner.address ? expectedOutputAmount : 0,
              WHTPairToken0 === WHTPartner.address ? 0 : expectedOutputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapExactHTForTokens(
              router.address,
              0,
              [WHT.address, WHTPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: swapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })

        it('gas', async () => {
          const WHTPartnerAmount = expandTo18Decimals(10)
          const HTAmount = expandTo18Decimals(5)
          await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
          await WHT.deposit({ value: HTAmount })
          await WHT.transfer(WHTPair.address, HTAmount)
          await WHTPair.mint(wallet.address, overrides)

          // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          await pair.sync(overrides)

          const swapAmount = expandTo18Decimals(1)
          await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
          const tx = await router.swapExactHTForTokens(
            0,
            [WHT.address, WHTPartner.address],
            wallet.address,
            MaxUint256,
            {
              ...overrides,
              value: swapAmount
            }
          )
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(
            {
              [RouterVersion.HubdaoRouter01]: 108769,
              [RouterVersion.HubdaoRouter02]: 108769
            }[routerVersion as RouterVersion]
          )
        }).retries(3)
      })

      describe('swapTokensForExactHT', () => {
        const WHTPartnerAmount = expandTo18Decimals(5)
        const HTAmount = expandTo18Decimals(10)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
          await WHT.deposit({ value: HTAmount })
          await WHT.transfer(WHTPair.address, HTAmount)
          await WHTPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WHTPartner.approve(router.address, MaxUint256)
          const WHTPairToken0 = await WHTPair.token0()
          await expect(
            router.swapTokensForExactHT(
              outputAmount,
              MaxUint256,
              [WHTPartner.address, WHT.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WHTPartner, 'Transfer')
            .withArgs(wallet.address, WHTPair.address, expectedSwapAmount)
            .to.emit(WHT, 'Transfer')
            .withArgs(WHTPair.address, router.address, outputAmount)
            .to.emit(WHTPair, 'Sync')
            .withArgs(
              WHTPairToken0 === WHTPartner.address
                ? WHTPartnerAmount.add(expectedSwapAmount)
                : HTAmount.sub(outputAmount),
              WHTPairToken0 === WHTPartner.address
                ? HTAmount.sub(outputAmount)
                : WHTPartnerAmount.add(expectedSwapAmount)
            )
            .to.emit(WHTPair, 'Swap')
            .withArgs(
              router.address,
              WHTPairToken0 === WHTPartner.address ? expectedSwapAmount : 0,
              WHTPairToken0 === WHTPartner.address ? 0 : expectedSwapAmount,
              WHTPairToken0 === WHTPartner.address ? 0 : outputAmount,
              WHTPairToken0 === WHTPartner.address ? outputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WHTPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapTokensForExactHT(
              router.address,
              outputAmount,
              MaxUint256,
              [WHTPartner.address, WHT.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })

      describe('swapExactTokensForHT', () => {
        const WHTPartnerAmount = expandTo18Decimals(5)
        const HTAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(1)
        const expectedOutputAmount = bigNumberify('1662497915624478906')

        beforeEach(async () => {
          await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
          await WHT.deposit({ value: HTAmount })
          await WHT.transfer(WHTPair.address, HTAmount)
          await WHTPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          await WHTPartner.approve(router.address, MaxUint256)
          const WHTPairToken0 = await WHTPair.token0()
          await expect(
            router.swapExactTokensForHT(
              swapAmount,
              0,
              [WHTPartner.address, WHT.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(WHTPartner, 'Transfer')
            .withArgs(wallet.address, WHTPair.address, swapAmount)
            .to.emit(WHT, 'Transfer')
            .withArgs(WHTPair.address, router.address, expectedOutputAmount)
            .to.emit(WHTPair, 'Sync')
            .withArgs(
              WHTPairToken0 === WHTPartner.address
                ? WHTPartnerAmount.add(swapAmount)
                : HTAmount.sub(expectedOutputAmount),
              WHTPairToken0 === WHTPartner.address
                ? HTAmount.sub(expectedOutputAmount)
                : WHTPartnerAmount.add(swapAmount)
            )
            .to.emit(WHTPair, 'Swap')
            .withArgs(
              router.address,
              WHTPairToken0 === WHTPartner.address ? swapAmount : 0,
              WHTPairToken0 === WHTPartner.address ? 0 : swapAmount,
              WHTPairToken0 === WHTPartner.address ? 0 : expectedOutputAmount,
              WHTPairToken0 === WHTPartner.address ? expectedOutputAmount : 0,
              router.address
            )
        })

        it('amounts', async () => {
          await WHTPartner.approve(routerEventEmitter.address, MaxUint256)
          await expect(
            routerEventEmitter.swapExactTokensForHT(
              router.address,
              swapAmount,
              0,
              [WHTPartner.address, WHT.address],
              wallet.address,
              MaxUint256,
              overrides
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([swapAmount, expectedOutputAmount])
        })
      })

      describe('swapHTForExactTokens', () => {
        const WHTPartnerAmount = expandTo18Decimals(10)
        const HTAmount = expandTo18Decimals(5)
        const expectedSwapAmount = bigNumberify('557227237267357629')
        const outputAmount = expandTo18Decimals(1)

        beforeEach(async () => {
          await WHTPartner.transfer(WHTPair.address, WHTPartnerAmount)
          await WHT.deposit({ value: HTAmount })
          await WHT.transfer(WHTPair.address, HTAmount)
          await WHTPair.mint(wallet.address, overrides)
        })

        it('happy path', async () => {
          const WHTPairToken0 = await WHTPair.token0()
          await expect(
            router.swapHTForExactTokens(
              outputAmount,
              [WHT.address, WHTPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(WHT, 'Transfer')
            .withArgs(router.address, WHTPair.address, expectedSwapAmount)
            .to.emit(WHTPartner, 'Transfer')
            .withArgs(WHTPair.address, wallet.address, outputAmount)
            .to.emit(WHTPair, 'Sync')
            .withArgs(
              WHTPairToken0 === WHTPartner.address
                ? WHTPartnerAmount.sub(outputAmount)
                : HTAmount.add(expectedSwapAmount),
              WHTPairToken0 === WHTPartner.address
                ? HTAmount.add(expectedSwapAmount)
                : WHTPartnerAmount.sub(outputAmount)
            )
            .to.emit(WHTPair, 'Swap')
            .withArgs(
              router.address,
              WHTPairToken0 === WHTPartner.address ? 0 : expectedSwapAmount,
              WHTPairToken0 === WHTPartner.address ? expectedSwapAmount : 0,
              WHTPairToken0 === WHTPartner.address ? outputAmount : 0,
              WHTPairToken0 === WHTPartner.address ? 0 : outputAmount,
              wallet.address
            )
        })

        it('amounts', async () => {
          await expect(
            routerEventEmitter.swapHTForExactTokens(
              router.address,
              outputAmount,
              [WHT.address, WHTPartner.address],
              wallet.address,
              MaxUint256,
              {
                ...overrides,
                value: expectedSwapAmount
              }
            )
          )
            .to.emit(routerEventEmitter, 'Amounts')
            .withArgs([expectedSwapAmount, outputAmount])
        })
      })
    })
  }
})
