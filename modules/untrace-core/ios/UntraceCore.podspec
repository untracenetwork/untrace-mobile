Pod::Spec.new do |s|
  s.name           = 'UntraceCore'
  s.version        = '0.2.0'
  s.summary        = 'Thin Expo module over the compiled, signed Untrace core.'
  s.description    = 'Calls the Untrace core C ABI. No crypto here: the core binary does it all.'
  s.license        = { :type => 'Apache-2.0' }
  s.author         = 'Untrace'
  s.homepage       = 'https://untrace.network'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.{h,swift}'
  s.public_header_files = 'UntraceCoreBridge.h'
  # Built by scripts/place-core.mjs at prebuild from the verified core binary
  # (aarch64-apple-ios + aarch64-apple-ios-sim). Gitignored, never published.
  s.vendored_frameworks = 'UntraceCoreFFI.xcframework'
end
