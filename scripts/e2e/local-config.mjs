export function disableLocalSeed(config) {
  const section = /(^\[db\.seed\][ \t]*\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m;
  if (!section.test(config)) throw new Error('The isolated E2E stack requires an explicit db.seed section.');
  return config.replace(section, (_match, header, body) => {
    if (!/^enabled[ \t]*=[ \t]*(true|false)[ \t]*$/m.test(body)) {
      throw new Error('The isolated E2E stack requires an explicit seed enabled setting.');
    }
    return header + body.replace(/^enabled[ \t]*=[ \t]*(true|false)[ \t]*$/m, 'enabled = false');
  });
}
