// @vitest-environment node
import { describe, expect, it } from "vitest"

import { verifyAssertion } from "./assertion"
import { verifyRegistration } from "./attestation"
import { parseAuthData, rpIdHashMatches } from "./authdata"
import { verifyClientData } from "./client-data"
import { parseCoseEc2Key } from "./cose"
import { parseAssertionCredential, parseRegistrationCredential } from "./public-key-json"
import { buildRegistrationOptions, buildRequestOptions } from "./options"
import { rpFromRequest } from "./rp"
import {
  clientDataJSON,
  makeAssertionFixture,
  makeAuthData,
  makeEcKey,
  makeRegistrationFixture,
  TEST_CHALLENGE_B64,
  TEST_ORIGIN,
  TEST_RP_ID,
} from "./test-utils"
import { base64urlEncode, WebAuthnError } from "./types"

describe("parseCoseEc2Key", () => {
  it("parses an EC2/P-256 ES256 key and rejects others", () => {
    const key = makeEcKey()
    const parsed = parseCoseEc2Key(key.coseBytes)
    expect(parsed?.key.crv).toBe(1)
    expect(parsed?.key.x).toHaveLength(32)
    expect(parsed?.key.y).toHaveLength(32)
    expect(parsed?.next).toBe(key.coseBytes.length)

    expect(parseCoseEc2Key(new Uint8Array([0xff]))).toBeNull()
    expect(parseCoseEc2Key(new TextEncoder().encode("not cbor"))).toBeNull()
  })
})

describe("parseAuthData / rpIdHashMatches", () => {
  it("parses flags, signCount, and attested credential data", () => {
    const authData = makeAuthData({ signCount: 42 })
    const parsed = parseAuthData(authData, true)
    expect(parsed.signCount).toBe(42)
    expect(parsed.attested?.credentialId).toHaveLength(16)
    expect(rpIdHashMatches(parsed.rpIdHash, TEST_RP_ID)).toBe(true)
    expect(rpIdHashMatches(parsed.rpIdHash, "evil.example.com")).toBe(false)
  })

  it("rejects truncated authData and missing attestation when expected", () => {
    expect(() => parseAuthData(new Uint8Array(10), false)).toThrow(WebAuthnError)
    const noAtt = makeAuthData({ flags: 0x01 })
    expect(() => parseAuthData(noAtt, true)).toThrow(/attested credential/i)
  })
})

describe("verifyClientData", () => {
  it("accepts a matching clientDataJSON", () => {
    const data = verifyClientData({
      clientDataJSON: clientDataJSON("webauthn.get"),
      expectedType: "webauthn.get",
      expectedChallenge: TEST_CHALLENGE_B64,
      expectedOrigin: TEST_ORIGIN,
    })
    expect(data.type).toBe("webauthn.get")
  })

  it("rejects wrong type, challenge, and origin", () => {
    const base = {
      expectedType: "webauthn.get",
      expectedChallenge: TEST_CHALLENGE_B64,
      expectedOrigin: TEST_ORIGIN,
    }
    expect(() =>
      verifyClientData({ ...base, clientDataJSON: clientDataJSON("webauthn.create") }),
    ).toThrow(/webauthn\.get/)
    expect(() =>
      verifyClientData({
        ...base,
        clientDataJSON: clientDataJSON("webauthn.get", base64urlEncode("other-challenge")),
      }),
    ).toThrow(/challenge/i)
    expect(() =>
      verifyClientData({
        ...base,
        clientDataJSON: clientDataJSON("webauthn.get", TEST_CHALLENGE_B64, "https://evil.example"),
      }),
    ).toThrow(/origin/i)
  })
})

describe("parseRegistrationCredential / parseAssertionCredential", () => {
  it("parses a registration credential JSON", () => {
    const fixture = makeRegistrationFixture()
    const parsed = parseRegistrationCredential(fixture.credentialJSON)
    expect(parsed.id).toBe(parsed.rawId)
    expect(parsed.clientDataJSON.length).toBeGreaterThan(0)
    expect(parsed.attestationObject.length).toBeGreaterThan(0)
    expect(parsed.transports).toEqual(["usb", "nfc"])
  })

  it("rejects malformed credential payloads", () => {
    expect(() => parseRegistrationCredential(null)).toThrow(WebAuthnError)
    expect(() => parseRegistrationCredential({ type: "public-key" })).toThrow(WebAuthnError)
    expect(() =>
      parseRegistrationCredential({
        type: "public-key",
        id: "a",
        rawId: "b",
        response: {},
      }),
    ).toThrow(WebAuthnError)
  })

  it("parses an assertion credential JSON including userHandle", () => {
    const fixture = makeAssertionFixture(makeEcKey())
    const parsed = parseAssertionCredential(fixture.credentialJSON)
    expect(parsed.signature.length).toBeGreaterThan(0)
    expect(parsed.userHandle).toBeNull()
  })
})

describe("verifyRegistration", () => {
  const input = {
    challenge: TEST_CHALLENGE_B64,
    rpId: TEST_RP_ID,
    origin: TEST_ORIGIN,
  }

  it("verifies a well-formed 'none' attestation and returns the credential", () => {
    const fixture = makeRegistrationFixture()
    const parsed = parseRegistrationCredential(fixture.credentialJSON)
    const verified = verifyRegistration({ credential: parsed, ...input })
    expect(verified.credentialId).toBe(fixture.credentialJSON.id)
    expect(verified.publicKeyCose.length).toBeGreaterThan(0)
    expect(verified.counter).toBe(0)
    expect(verified.transports).toEqual(["usb", "nfc"])
    expect(verified.aaguid).toBe(base64urlEncode(new Uint8Array(16)))
  })

  it("rejects a wrong challenge", () => {
    const fixture = makeRegistrationFixture({ challengeB64: base64urlEncode("wrong") })
    const parsed = parseRegistrationCredential(fixture.credentialJSON)
    expect(() => verifyRegistration({ credential: parsed, ...input })).toThrow(/challenge/i)
  })

  it("rejects a wrong origin and rpId", () => {
    const badOrigin = makeRegistrationFixture({ origin: "https://evil.example" })
    expect(() =>
      verifyRegistration({
        credential: parseRegistrationCredential(badOrigin.credentialJSON),
        ...input,
      }),
    ).toThrow(/origin/i)

    const badRp = makeRegistrationFixture({ rpId: "evil.example.com" })
    expect(() =>
      verifyRegistration({
        credential: parseRegistrationCredential(badRp.credentialJSON),
        ...input,
      }),
    ).toThrow(/rpId/i)
  })

  it("rejects non-'none' attestation formats", () => {
    const fixture = makeRegistrationFixture({ fmt: "packed" })
    expect(() =>
      verifyRegistration({
        credential: parseRegistrationCredential(fixture.credentialJSON),
        ...input,
      }),
    ).toThrow(/Attestation format/)
  })

  it("rejects authData without the UP flag or without attested data", () => {
    const noUp = makeRegistrationFixture({ flags: 0x40 }) // AT set, UP clear
    expect(() =>
      verifyRegistration({
        credential: parseRegistrationCredential(noUp.credentialJSON),
        ...input,
      }),
    ).toThrow(/user presence/i)
  })
})

describe("verifyAssertion", () => {
  function setup() {
    const key = makeEcKey()
    const credentialId = new Uint8Array(16).fill(9)
    const fixture = makeAssertionFixture(key, { credentialId, signCount: 5 })
    return { key, credentialId, fixture }
  }

  const input = {
    challenge: TEST_CHALLENGE_B64,
    rpId: TEST_RP_ID,
    origin: TEST_ORIGIN,
  }

  it("verifies a real ECDSA signature and returns the counter", () => {
    const { key, fixture } = setup()
    const verified = verifyAssertion({
      credential: parseAssertionCredential(fixture.credentialJSON),
      ...input,
      publicKeyCose: key.coseB64,
      storedCounter: 4,
    })
    expect(verified.signCount).toBe(5)
    expect(verified.credentialId).toBe(fixture.credentialJSON.rawId)
  })

  it("rejects a tampered signature", () => {
    const { key, fixture } = setup()
    const tampered = makeAssertionFixture(key, {
      credentialId: fixture.credentialIdBytes,
      signCount: 5,
      tamper: true,
    })
    expect(() =>
      verifyAssertion({
        credential: parseAssertionCredential(tampered.credentialJSON),
        ...input,
        publicKeyCose: key.coseB64,
        storedCounter: 4,
      }),
    ).toThrow(/signature/i)
  })

  it("rejects counter regression when both counters are non-zero", () => {
    const { key, fixture } = setup()
    expect(() =>
      verifyAssertion({
        credential: parseAssertionCredential(fixture.credentialJSON),
        ...input,
        publicKeyCose: key.coseB64,
        storedCounter: 5, // signCount must be > stored
      }),
    ).toThrow(/counter/i)
  })

  it("allows zero counters (counter-less authenticators)", () => {
    const key = makeEcKey()
    const fixture = makeAssertionFixture(key, { signCount: 0, storedCounter: 0 })
    const verified = verifyAssertion({
      credential: parseAssertionCredential(fixture.credentialJSON),
      ...input,
      publicKeyCose: key.coseB64,
      storedCounter: 0,
    })
    expect(verified.signCount).toBe(0)
  })

  it("rejects a signature made by a different key", () => {
    const { fixture } = setup()
    const other = makeEcKey()
    expect(() =>
      verifyAssertion({
        credential: parseAssertionCredential(fixture.credentialJSON),
        ...input,
        publicKeyCose: other.coseB64,
        storedCounter: 4,
      }),
    ).toThrow(/signature/i)
  })
})

describe("userHandle enforcement (passkeys)", () => {
  const uhInput = {
    challenge: TEST_CHALLENGE_B64,
    rpId: TEST_RP_ID,
    origin: TEST_ORIGIN,
  }

  function passkeyFixture(userHandle?: string) {
    const key = makeEcKey()
    const fixture = makeAssertionFixture(key, {
      credentialId: new Uint8Array(16).fill(6),
      signCount: 3,
      storedCounter: 2,
      userHandle,
    })
    return { key, fixture }
  }

  it("accepts a userHandle that decodes to the expected user id", () => {
    const { key, fixture } = passkeyFixture("user-1")
    const parsed = parseAssertionCredential(fixture.credentialJSON)
    expect(parsed.userHandle).not.toBeNull()
    const verified = verifyAssertion({
      credential: parsed,
      ...uhInput,
      publicKeyCose: key.coseB64,
      storedCounter: 2,
      expectedUserId: "user-1",
      requireUserHandle: true,
    })
    expect(verified.signCount).toBe(3)
  })

  it("rejects a userHandle belonging to a different user", () => {
    const { key, fixture } = passkeyFixture("user-2")
    expect(() =>
      verifyAssertion({
        credential: parseAssertionCredential(fixture.credentialJSON),
        ...uhInput,
        publicKeyCose: key.coseB64,
        storedCounter: 2,
        expectedUserId: "user-1",
      }),
    ).toThrow(/user handle/i)
  })

  it("requires a userHandle on the discoverable (anonymous) path", () => {
    const key = makeEcKey()
    const fixture = makeAssertionFixture(key, {
      credentialId: new Uint8Array(16).fill(7),
      signCount: 3,
      storedCounter: 2,
      // no userHandle — a non-resident credential cannot answer
      // allowCredentials: [] in a real browser, but a forged payload could
      // try; the server must reject it.
    })
    expect(() =>
      verifyAssertion({
        credential: parseAssertionCredential(fixture.credentialJSON),
        ...uhInput,
        publicKeyCose: key.coseB64,
        storedCounter: 2,
        expectedUserId: "user-1",
        requireUserHandle: true,
      }),
    ).toThrow(/user handle/i)
  })

  it("allows a null userHandle for non-resident security keys", () => {
    const key = makeEcKey()
    const fixture = makeAssertionFixture(key, {
      credentialId: new Uint8Array(16).fill(8),
      signCount: 3,
      storedCounter: 2,
    })
    const verified = verifyAssertion({
      credential: parseAssertionCredential(fixture.credentialJSON),
      ...uhInput,
      publicKeyCose: key.coseB64,
      storedCounter: 2,
      expectedUserId: "user-1",
      requireUserHandle: false,
    })
    expect(verified.signCount).toBe(3)
  })
})

describe("options builders", () => {
  it("builds registration options with base64url fields and ES256 params", () => {
    const options = buildRegistrationOptions({
      challenge: TEST_CHALLENGE_B64,
      rpId: TEST_RP_ID,
      rpName: "Spindle",
      userId: "user-123",
      userName: "ada@example.com",
      userDisplayName: "Ada",
      excludeCredentials: [{ type: "public-key", id: "abc", transports: ["usb"] }],
    })
    expect(options.rp).toEqual({ name: "Spindle", id: TEST_RP_ID })
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }])
    expect(options.attestation).toBe("none")
    expect(options.excludeCredentials[0].id).toBe("abc")
    // user.id is base64url of the UTF-8 user id
    expect(Buffer.from(options.user.id, "base64url").toString()).toBe("user-123")
  })

  it("builds request options with optional allowCredentials", () => {
    const options = buildRequestOptions({ challenge: TEST_CHALLENGE_B64, rpId: TEST_RP_ID })
    expect(options.allowCredentials).toEqual([])
    expect(options.userVerification).toBe("preferred")
  })

  it("builds passkey (resident-key) registration options when requested", () => {
    const options = buildRegistrationOptions({
      challenge: TEST_CHALLENGE_B64,
      rpId: TEST_RP_ID,
      rpName: "Spindle",
      userId: "user-123",
      userName: "ada@example.com",
      userDisplayName: "Ada",
      residentKey: "required",
      userVerification: "preferred",
    })
    expect(options.authenticatorSelection).toEqual({
      residentKey: "required",
      userVerification: "preferred",
      requireResidentKey: true,
    })
    // The user handle is still the UTF-8 user id — discoverable credentials
    // echo it back as the assertion's userHandle.
    expect(Buffer.from(options.user.id, "base64url").toString()).toBe("user-123")
  })

  it("defaults to non-required resident key for security-key registration", () => {
    const options = buildRegistrationOptions({
      challenge: TEST_CHALLENGE_B64,
      rpId: TEST_RP_ID,
      rpName: "Spindle",
      userId: "user-123",
      userName: "ada@example.com",
      userDisplayName: "Ada",
    })
    expect(options.authenticatorSelection.residentKey).toBe("preferred")
    expect(options.authenticatorSelection.requireResidentKey).toBe(false)
  })
})

describe("rpFromRequest", () => {
  it("derives rpId and origin from the request URL", () => {
    const rp = rpFromRequest(new Request("https://app.example.com/api/auth/webauthn/auth/begin"))
    expect(rp.rpId).toBe("app.example.com")
    expect(rp.origin).toBe("https://app.example.com")
    expect(rp.rpName).toBe("Spindle")
  })
})
