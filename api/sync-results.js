// Vercel Serverless Function — proxy hacia API-Football
// Env var requerida: API_FOOTBALL_KEY  (dashboard.vercel.com > Settings > Environment Variables)

const SEASON   = 2026;
const MEX_TEAM = 164; // ID de México en API-Football

const MATCH_DATES = {
  MEX_M1: '2026-06-11',
  MEX_M2: '2026-06-18',
  MEX_M3: '2026-06-24',
};

const STAT = {
  CORNERS:      'Corner Kicks',
  YELLOW_CARDS: 'Yellow Cards',
  RED_CARDS:    'Red Cards',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return res.status(500).json({ error: 'API_FOOTBALL_KEY no configurada en Vercel' });

  const { matchId } = req.query;
  const date = MATCH_DATES[matchId];
  if (!date) return res.status(400).json({ error: `matchId inválido: ${matchId}` });

  const apiFetch = (path) =>
    fetch(`https://v3.football.api-sports.io/${path}`, {
      headers: { 'x-apisports-key': key },
    }).then(r => r.json());

  try {
    // 1. Buscar fixture por fecha + equipo (sin filtrar liga — el ID puede variar por torneo)
    const fixtureData = await apiFetch(
      `fixtures?date=${date}&season=${SEASON}&team=${MEX_TEAM}`
    );

    // Devolver debug si no hay resultados para ayudar a diagnosticar
    if (!fixtureData.response || fixtureData.response.length === 0) {
      return res.json({
        status: 'not_found',
        message: 'Fixture no encontrado en API-Football',
        debug: {
          errors: fixtureData.errors,
          results: fixtureData.results,
          paging: fixtureData.paging,
        },
      });
    }

    const fx = fixtureData.response[0];
    const fxId      = fx.fixture.id;
    const fxStatus  = fx.fixture.status.short; // NS | 1H | HT | 2H | ET | FT | PEN | PST
    const homeGoals = fx.goals.home;
    const awayGoals = fx.goals.away;

    if (fxStatus === 'NS' || fxStatus === 'PST') {
      return res.json({ status: fxStatus });
    }

    // 2. Estadísticas
    const statsData = await apiFetch(`fixtures/statistics?fixture=${fxId}`);

    let corners = 0, yellowCards = 0, redCards = 0;
    for (const team of (statsData.response || [])) {
      for (const s of team.statistics) {
        if (s.type === STAT.CORNERS)      corners     += s.value ?? 0;
        if (s.type === STAT.YELLOW_CARDS) yellowCards += s.value ?? 0;
        if (s.type === STAT.RED_CARDS)    redCards    += s.value ?? 0;
      }
    }

    // 3. Eventos — minuto del primer gol
    const eventsData = await apiFetch(`fixtures/events?fixture=${fxId}`);

    let firstGoalMinute = null;
    const goals = (eventsData.response || [])
      .filter(e => e.type === 'Goal' && e.detail !== 'Missed Penalty')
      .sort((a, b) => a.time.elapsed - b.time.elapsed);
    if (goals.length > 0) {
      const g = goals[0];
      firstGoalMinute = g.time.elapsed + (g.time.extra ?? 0);
    }

    return res.json({
      status:          fxStatus,
      home:            homeGoals !== null ? String(homeGoals) : null,
      away:            awayGoals !== null ? String(awayGoals) : null,
      corners:         String(corners),
      yellowCards:     String(yellowCards),
      redCards:        String(redCards),
      firstGoalMinute: firstGoalMinute !== null ? String(firstGoalMinute) : null,
      fixtureId:       fxId,
      league:          fx.league?.id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
