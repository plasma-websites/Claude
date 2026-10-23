// Reads a Components V2 panel ({ components: [container], flags }) for assertions:
// all its text, the custom IDs / URLs of its buttons and menus, its menus, and how
// many components it uses (Discord allows 40 per message).
export function card(panel) {
  const json = panel.components[0].toJSON();
  const texts = [];
  const ids = [];
  const menus = [];
  let count = 0;
  const walk = (c) => {
    count += 1;
    if (c.type === 10) texts.push(c.content);
    if (c.type === 2) ids.push(c.custom_id ?? c.url);
    if (c.type === 3) {
      ids.push(c.custom_id);
      menus.push(c);
    }
    for (const child of c.components ?? []) walk(child);
    if (c.accessory) walk(c.accessory);
  };
  walk(json);
  return { json, text: texts.join('\n'), ids, menus, count };
}
