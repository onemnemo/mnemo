import { describe, expect, it } from "vitest"

import { ONBOARDING_COMPLETED_KEY } from "@/onboarding/first-run"

import { BETA_NOTICE_SEEN_VERSION_KEY, needsBetaNotice } from "./beta-notice"

const ready = { loaded: true, failed: false, values: { [ONBOARDING_COMPLETED_KEY]: true } }
const beta = { version: "0.8.0-beta.2+3f9c1a2", runningChannel: "beta" } as const

describe("the beta notice decision", () => {
  it("shows on a beta build nobody has acknowledged", () => {
    expect(needsBetaNotice(ready, beta)).toBe(true)
  })

  it("shows for a release candidate, which the host files under beta", () => {
    expect(needsBetaNotice(ready, { version: "0.8.0-rc.1", runningChannel: "beta" })).toBe(true)
  })

  it("does not show the same version twice", () => {
    const values = { ...ready.values, [BETA_NOTICE_SEEN_VERSION_KEY]: beta.version }
    expect(needsBetaNotice({ ...ready, values }, beta)).toBe(false)
  })

  it("shows once more for a later beta after an older acknowledgement", () => {
    const values = { ...ready.values, [BETA_NOTICE_SEEN_VERSION_KEY]: "0.8.0-beta.1+a1b2c3d" }
    expect(needsBetaNotice({ ...ready, values }, beta)).toBe(true)
  })

  it("matches the acknowledgement to the exact running version, build metadata included", () => {
    const values = { ...ready.values, [BETA_NOTICE_SEEN_VERSION_KEY]: "0.8.0-beta.2" }
    expect(needsBetaNotice({ ...ready, values }, beta)).toBe(true)
  })

  it("stays quiet on a stable build", () => {
    expect(needsBetaNotice(ready, { version: "0.8.0", runningChannel: "stable" })).toBe(false)
  })

  it("stays quiet on a nightly or alpha build, both of which the host files under nightly", () => {
    expect(needsBetaNotice(ready, { version: "0.8.0-nightly.7", runningChannel: "nightly" })).toBe(false)
    expect(needsBetaNotice(ready, { version: "0.8.0-alpha.1", runningChannel: "nightly" })).toBe(false)
  })

  it("reads the running build, not the update channel the user picked", () => {
    const values = { ...ready.values, "Updates.Channel": "stable" }
    expect(needsBetaNotice({ ...ready, values }, beta)).toBe(true)
  })

  it("waits behind first-time setup, then shows once it has finished", () => {
    expect(needsBetaNotice({ ...ready, values: {} }, beta)).toBe(false)
    expect(needsBetaNotice({ ...ready, values: { [ONBOARDING_COMPLETED_KEY]: false } }, beta)).toBe(false)
    expect(needsBetaNotice(ready, beta)).toBe(true)
  })

  it("stays quiet while the snapshot is loading or after it failed to load", () => {
    expect(needsBetaNotice({ ...ready, loaded: false }, beta)).toBe(false)
    expect(needsBetaNotice({ ...ready, failed: true }, beta)).toBe(false)
  })

  it("stays quiet until the running build is known", () => {
    expect(needsBetaNotice(ready, null)).toBe(false)
    expect(needsBetaNotice(ready, { version: "", runningChannel: "beta" })).toBe(false)
  })
})
