import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { constants } from "ethers"
import { keccak256 } from "ethers/lib/utils"
import { deployments } from "hardhat"
import { ReferralStorage } from "../../types"

const { AddressZero, HashZero } = constants

describe("ReferralStorage", () => {
  let signers: SignerWithAddress[]
  let wallet: SignerWithAddress
  let user0: SignerWithAddress
  let user1: SignerWithAddress
  let user2: SignerWithAddress
  let referralStorage: ReferralStorage

  const setupTest = deployments.createFixture(async ({ deployments, ethers }) => {
    await deployments.fixture()
    signers = await ethers.getSigners()
      ;[wallet, user0, user1, user2] = signers
    const referralStorageFactory = await ethers.getContractFactory('ReferralStorage')
    referralStorage = (await referralStorageFactory.deploy()) as ReferralStorage
  })

  beforeEach(async () => {
    await setupTest()
  })

  it("setReferralCode", async () => {
    const code = keccak256("0xFF")

    expect(await referralStorage.referralCodes(user1.address)).eq(HashZero)
    await referralStorage.connect(user0).setReferralCodeByUser(code)
    expect(await referralStorage.referralCodes(user0.address)).eq(code)

    const code2 = keccak256("0x0F0F")
    await referralStorage.connect(user1).setReferralCodeByUser(code2)
    expect(await referralStorage.referralCodes(user1.address)).eq(code2)
  })

  it("Registers code", async () => {
    await expect(referralStorage.connect(user0).registerCode(HashZero))
      .to.be.revertedWithCustomError(referralStorage, 'InvalidCode')

    const code = keccak256("0xFF")
    expect(await referralStorage.codeOwners(code)).to.be.equal(AddressZero)

    await referralStorage.connect(user0).registerCode(code)
    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address)
    expect(await referralStorage.getOwnedCodes(user0.address)).to.be.deep.eq([code])

    await expect(referralStorage.connect(user0).registerCode(code))
      .to.be.revertedWithCustomError(referralStorage, 'CodeAlreadyExists')

    const code2 = keccak256("0xFF11")
    await referralStorage.connect(user0).registerCode(code2)
    expect(await referralStorage.getOwnedCodes(user0.address)).to.be.deep.eq([code, code2])

    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address)
    expect(await referralStorage.codeOwners(code2)).to.be.equal(user0.address)
  })

  it("setCodeOwner", async () => {
    const code = keccak256("0xFF")

    await referralStorage.connect(user0).registerCode(code)
    expect(await referralStorage.codeOwners(code)).to.be.equal(user0.address)
    expect(await referralStorage.getOwnedCodes(user0.address)).to.be.deep.eq([code])

    await expect(referralStorage.connect(user1).setCodeOwner(HashZero, user2.address))
      .to.be.revertedWithCustomError(referralStorage, 'InvalidCode')

    await expect(referralStorage.connect(user1).setCodeOwner(code, user2.address))
      .to.be.revertedWithCustomError(referralStorage, 'NotCodeOwner')
    await referralStorage.connect(user0).setCodeOwner(code, user2.address)
    expect(await referralStorage.getOwnedCodes(user0.address)).to.be.deep.eq([])
    expect(await referralStorage.getOwnedCodes(user2.address)).to.be.deep.eq([code])

    expect(await referralStorage.codeOwners(code)).to.be.equal(user2.address)
  })

  it("getReferralInfo", async () => {
    const code = keccak256("0xFF")

    let info = await referralStorage.getReferralInfo(user1.address)
    expect(info[0]).eq(HashZero)
    expect(info[1]).eq(AddressZero)

    await referralStorage.connect(user1).setReferralCodeByUser(code)

    info = await referralStorage.getReferralInfo(user1.address)
    expect(info[0]).eq(code)
    expect(info[1]).eq(AddressZero)

    await referralStorage.connect(user1).registerCode(code)

    info = await referralStorage.getReferralInfo(user1.address)
    expect(info[0]).eq(code)
    expect(info[1]).eq(user1.address)
  })
}) 
