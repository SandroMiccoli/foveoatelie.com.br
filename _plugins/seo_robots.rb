# frozen_string_literal: true

# Mantém deploys que não são produção fora do índice.
#
# A Netlify define CONTEXT como production, deploy-preview, branch-deploy
# ou dev. Ela já envia X-Robots-Tag: noindex em deploy previews e em
# deploys antigos de branch, mas não no deploy mais recente de cada
# branch — é o caso de dev.foveoatelie.com.br e
# dev--foveoatelie.netlify.app (CONTEXT=branch-deploy).
#
# [[headers]] no netlify.toml vale para todos os deploys, então o noindex
# não pode ficar lá. Este hook grava _site/_headers só fora de produção.
# Build local, sem CONTEXT, fica indexável: é o mesmo HTML da produção.

module Foveo
  module SeoRobots
    module_function

    def indexable?
      context = ENV.fetch("CONTEXT", "")
      context.empty? || context == "production"
    end
  end
end

Jekyll::Hooks.register :site, :after_init do |site|
  site.config["seo_indexable"] = Foveo::SeoRobots.indexable?
end

Jekyll::Hooks.register :site, :post_write do |site|
  next if site.config["seo_indexable"]

  headers = File.join(site.dest, "_headers")
  File.write(headers, <<~TEXT)
    /*
      X-Robots-Tag: noindex
  TEXT
  Jekyll.logger.info(
    "SEO:",
    "CONTEXT=#{ENV.fetch('CONTEXT', '')} BRANCH=#{ENV.fetch('BRANCH', '')} — X-Robots-Tag: noindex"
  )
end
