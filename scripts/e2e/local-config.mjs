function disableSection(config, name) {
  const section = new RegExp(`(^\\[${name.replaceAll('.', '\\.')}\\][ \\t]*\\r?\\n)([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm');
  if (!section.test(config)) throw new Error(`The isolated E2E stack requires an explicit ${name} section.`);
  return config.replace(section, (_match, header, body) => {
    if (!/^enabled[ \t]*=[ \t]*(true|false)[ \t]*$/m.test(body)) {
      throw new Error(`The isolated E2E stack requires an explicit ${name} enabled setting.`);
    }
    return header + body.replace(/^enabled[ \t]*=[ \t]*(true|false)[ \t]*$/m, 'enabled = false');
  });
}

export function disableLocalSeed(config) {
  return disableSection(config, 'db.seed');
}

export function configureLocalE2E(config) {
  // These are developer tools, not application auth/storage/realtime or DB audit.
  for (const section of ['db.seed', 'studio', 'edge_runtime', 'analytics']) {
    config = disableSection(config, section);
  }
  return config;
}
