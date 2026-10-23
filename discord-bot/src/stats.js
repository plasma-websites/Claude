import { MessageFlags } from 'discord.js';
import { localNow } from './schedule.js';
import { COLORS, ephemeral, hasRole, isAdmin, isOrderer } from './util.js';
import { dailyStatsView, personalStatsEmbed } from './views.js';

// Daily stats: posted in the stats channel at midnight (TIMEZONE), pinging the
// orderer role, with a button for each orderer's own numbers. /stats shows today so far.
export function createStats({ client, config, store }) {
  const dateOf = (iso) => localNow(config.timezone, new Date(iso)).date;
  const statsFor = (date) => store.dailyStats(date, dateOf);
  const isStaff = (interaction) => isOrderer(interaction.member, config) || hasRole(interaction.member, config.supportRoleId) || isAdmin(interaction);

  async function postDaily(date) {
    const channel = await client.channels.fetch(config.statsChannelId);
    await channel.send({ ...dailyStatsView(statsFor(date), { ping: `<@&${config.ordererRoleId}>` }), allowedMentions: { roles: [config.ordererRoleId] } });
  }

  // Runs every 30 seconds; posts yesterday's stats once, just after midnight.
  async function tick() {
    const now = localNow(config.timezone);
    if (now.minutes > 5) return;
    const yesterday = localNow(config.timezone, new Date(Date.now() - 6 * 60 * 60 * 1000)).date;
    if (store.getMeta('lastDailyStats') === yesterday) return;
    store.setMeta('lastDailyStats', yesterday);
    await postDaily(yesterday);
  }

  function today(interaction) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can see stats.', {}, { color: COLORS.danger }));
    const view = dailyStatsView(statsFor(localNow(config.timezone).date), { title: 'Today so far' });
    return interaction.reply({ ...view, flags: view.flags | MessageFlags.Ephemeral });
  }

  function handleComponent(interaction) {
    const [, action, date] = interaction.customId.split(':');
    if (action !== 'me') return;
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff have personal stats.', {}, { color: COLORS.danger }));
    return interaction.reply({ embeds: [personalStatsEmbed(statsFor(date), interaction.user.id)], flags: MessageFlags.Ephemeral });
  }

  return { tick, today, handleComponent, postDaily };
}
