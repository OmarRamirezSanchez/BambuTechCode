import { Component, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { createRadAccount } from "@/rad-account"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

/** The RAD session of a governed BambuTechCode: who is signed in, its connection to BambuIAFrameWork, and sign-out. */
export const SettingsAccount: Component = () => {
  const language = useLanguage()
  const account = createRadAccount()

  const framework = () => {
    if (account.state.framework === "connected") return language.t("settings.account.framework.connected")

    if (account.state.framework === "unavailable") return language.t("settings.account.framework.unavailable")

    return language.t("settings.account.framework.connecting")
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.account")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.account.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.account.section.session")}</h3>
          <SettingsList>
            <SettingsRow title={language.t("settings.account.member")} description={account.state.email}>
              <span data-action="settings-account-member" class="text-13-medium text-v2-text-text-base">
                {account.state.name}
              </span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.account.environment")}
              description={language.t("settings.account.environment.description")}
            >
              <span class="text-13-regular text-v2-text-text-muted">{account.state.origin}</span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.account.framework")}
              description={language.t("settings.account.framework.description")}
            >
              <span data-action="settings-account-framework" class="text-13-regular text-v2-text-text-base">
                {framework()}
              </span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.account.history")}
              description={
                account.state.pending > 0
                  ? language.t("rad.syncPending")
                  : language.t("settings.account.history.description")
              }
            >
              <Button size="normal" variant="ghost-muted" onClick={account.history}>
                {language.t("rad.history")}
              </Button>
            </SettingsRow>
          </SettingsList>
          <Show when={account.state.error}>
            <span role="alert" class="text-12-regular text-v2-text-text-muted">
              {language.t("settings.account.expired")}
            </span>
          </Show>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.account.section.signOut")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("rad.logout")}
              description={language.t("settings.account.signOut.description")}
            >
              <Button
                data-action="settings-account-sign-out"
                size="normal"
                variant="neutral"
                onClick={() => void account.logout()}
              >
                {language.t("settings.account.signOut")}
              </Button>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
