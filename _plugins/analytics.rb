# frozen_string_literal: true

# Google Analytics 4 e o aviso de cookies só entram no HTML de um
# deploy de produção da Netlify (CONTEXT=production), e nunca quando
# a branch é dev ou obrigado. Branch deploy e deploy preview ficam
# de fora porque o CONTEXT deles não é production.
#
# O ID em google_analytics é público. Mesmo preenchido, não é impresso
# nesses outros deploys: o HTML nem referencia o gtag.
#
# FV_SHOW_CONSENT=1 desenha só a barra, sem carregar script do Google.
# Serve para revisar o layout num build local.

module Foveo
  module Analytics
    ID_PATTERN = /\AG-[A-Za-z0-9]+\z/

    module_function

    def production_deploy?
      context = ENV.fetch("CONTEXT", "")
      branch = ENV.fetch("BRANCH", "")
      context == "production" && branch != "dev" && branch != "obrigado"
    end

    def measurement_id(site)
      raw = site.config["google_analytics"].to_s.strip
      return "" unless raw.match?(ID_PATTERN)

      raw
    end
  end
end

Jekyll::Hooks.register :site, :after_init do |site|
  id = Foveo::Analytics.measurement_id(site)
  enabled = Foveo::Analytics.production_deploy? && !id.empty?
  site.config["google_analytics_id"] = enabled ? id : ""
  site.config["analytics_enabled"] = enabled
  site.config["show_consent"] = enabled || ENV["FV_SHOW_CONSENT"] == "1"
end
