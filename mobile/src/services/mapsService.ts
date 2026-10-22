import * as Location from 'expo-location';
import { CalculatedRoute, Coordinates, RouteStep } from '../types/mat';

// Lê a chave da API do Google Maps configurada no arquivo .env
const GOOGLE_MAPS_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();

// Coordenadas padrão de fallback caso o GPS esteja totalmente desativado
const DEFAULT_ORIGIN: Coordinates = {
  latitude: -23.5505, // São Paulo - Centro
  longitude: -46.6333,
};

// Limpa preâmbulos conversacionais de fala para extrair o endereço real
export function cleanVoiceQuery(query: string): string {
  let cleaned = query.trim().replace(/[.,;?!]+$/g, '');

  const conversationalPrefixes = [
    /^(por favor\s+)?(me\s+)?(leva|leve|levar)(\s+ao|\s+à|\s+pra|\s+para|\s+no|\s+na|\s+até)?\s+/i,
    /^(eu\s+)?(quero\s+)?(ir|caminhar|navegar)(\s+ao|\s+à|\s+pra|\s+para|\s+no|\s+na|\s+até)?\s+/i,
    /^(como\s+)?(eu\s+)?(chego|chegar)(\s+em|\s+no|\s+na|\s+ao|\s+à|\s+pra|\s+para|\s+até)?\s+/i,
    /^(onde\s+fica|qual\s+o\s+caminho\s+(para|pra|até)|rota\s+(para|pra|até))\s+/i,
    /^(dirija-se\s+a|siga\s+para|ir\s+para|ir\s+pra|ir\s+ao|ir\s+à)\s+/i,
  ];

  for (const prefix of conversationalPrefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  return cleaned.trim();
}

// Remove tags HTML retornadas nas instruções da Google Directions API
function stripHtmlTags(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Formata metros para leitura natural em português ("350 m" ou "1,2 km")
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

// Formata segundos em minutos ("5 min")
function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

// Consolida micro-segmentos geométricos do OSRM em passos claros e humanizados
function consolidateOsrmSteps(
  rawSteps: any[],
  destCoords: Coordinates,
  foundName: string
): RouteStep[] {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return [];
  }

  const consolidated: RouteStep[] = [];

  const translateManeuver = (
    type?: string,
    modifier?: string
  ): { action: string; maneuver: RouteStep['maneuver'] } => {
    const mod = (modifier || '').toLowerCase();
    const typ = (type || '').toLowerCase();

    if (typ === 'arrive') {
      return { action: 'Você chegará ao destino', maneuver: 'straight' };
    }
    if (mod.includes('sharp left')) {
      return { action: 'Faça curva acentuada à esquerda', maneuver: 'turn-left' };
    }
    if (mod.includes('sharp right')) {
      return { action: 'Faça curva acentuada à direita', maneuver: 'turn-right' };
    }
    if (mod.includes('slight left')) {
      return { action: 'Mantenha-se levemente à esquerda', maneuver: 'turn-left' };
    }
    if (mod.includes('slight right')) {
      return { action: 'Mantenha-se levemente à direita', maneuver: 'turn-right' };
    }
    if (mod.includes('left')) {
      return { action: 'Vire à esquerda', maneuver: 'turn-left' };
    }
    if (mod.includes('right')) {
      return { action: 'Vire à direita', maneuver: 'turn-right' };
    }
    return { action: 'Siga em frente', maneuver: 'straight' };
  };

  let accumulatedDist = 0;
  let accumulatedSec = 0;
  let currentStreet = '';
  let currentAction = 'Siga em frente';
  let currentManeuver: RouteStep['maneuver'] = 'straight';
  let currentEndLocation: Coordinates = destCoords;

  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i];
    const dist = Math.round(s.distance || 0);
    const sec = Math.round(s.duration || dist / 1.1);
    const street = (s.name || '').trim();
    const { action, maneuver } = translateManeuver(s.maneuver?.type, s.maneuver?.modifier);

    const nextLoc = rawSteps[i + 1]?.maneuver?.location;
    const stepEndCoords: Coordinates =
      Array.isArray(nextLoc) && nextLoc.length >= 2
        ? { latitude: Number(nextLoc[1]), longitude: Number(nextLoc[0]) }
        : destCoords;

    if (i === 0) {
      accumulatedDist = dist;
      accumulatedSec = sec;
      currentStreet = street;
      currentAction = action;
      currentManeuver = maneuver;
      currentEndLocation = stepEndCoords;
      continue;
    }

    const isTurn = maneuver !== 'straight' || s.maneuver?.type === 'arrive';
    const isSameStreet =
      street && currentStreet && street.toLowerCase() === currentStreet.toLowerCase();

    // Se continuar reto e na mesma rua (ou for calçada curta sem nome < 25m), acumula a distância
    if (!isTurn && (!street || isSameStreet || accumulatedDist < 25)) {
      accumulatedDist += dist;
      accumulatedSec += sec;
      currentEndLocation = stepEndCoords;
      if (street && !currentStreet) {
        currentStreet = street;
      }
    } else {
      // Fecha o passo anterior acumulado
      if (accumulatedDist > 0) {
        const streetLabel = currentStreet ? ` pela ${currentStreet}` : '';
        consolidated.push({
          instruction: `${currentAction}${streetLabel} por ${formatDistance(accumulatedDist)}`,
          distanceText: formatDistance(accumulatedDist),
          distanceMeters: Math.max(15, accumulatedDist),
          durationText: formatDuration(accumulatedSec),
          maneuver: currentManeuver,
          endLocation: currentEndLocation,
        });
      }

      accumulatedDist = dist;
      accumulatedSec = sec;
      currentStreet = street;
      currentAction = action;
      currentManeuver = maneuver;
      currentEndLocation = stepEndCoords;
    }
  }

  // Despeja o último passo
  if (accumulatedDist > 0) {
    const streetLabel = currentStreet ? ` pela ${currentStreet}` : '';
    consolidated.push({
      instruction: `${currentAction}${streetLabel} por ${formatDistance(accumulatedDist)}`,
      distanceText: formatDistance(accumulatedDist),
      distanceMeters: Math.max(15, accumulatedDist),
      durationText: formatDuration(accumulatedSec),
      maneuver: currentManeuver,
      endLocation: currentEndLocation,
    });
  }

  // Garante uma instrução de chegada no fim
  const last = consolidated[consolidated.length - 1];
  if (!last || !last.instruction.toLowerCase().includes('destino')) {
    consolidated.push({
      instruction: `Você chegou ao seu destino: ${foundName}.`,
      distanceText: '10 m',
      distanceMeters: 10,
      durationText: '1 min',
      maneuver: 'straight',
      endLocation: destCoords,
    });
  }

  return consolidated;
}

export const mapsService = {
  // Verifica se há uma chave de API do Google Maps configurada no .env
  isGoogleMapsConfigured(): boolean {
    return GOOGLE_MAPS_API_KEY.length > 10;
  },

  // Calcula a distância em metros entre duas coordenadas GPS (Fórmula de Haversine)
  getDistanceMeters(a: Coordinates, b: Coordinates): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h =
      sinDLat * sinDLat +
      Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  },

  // Monitora o deslocamento do usuário em tempo real via GPS durante a navegação ativa
  async watchUserPosition(
    onUpdate: (coords: Coordinates) => void
  ): Promise<Location.LocationSubscription | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }
      return await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1500,
          distanceInterval: 2,
        },
        (loc) => {
          onUpdate({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      );
    } catch {
      return null;
    }
  },

  // Obtém a localização de GPS atual do smartphone com suporte a cache imediato
  async getCurrentCoordinates(): Promise<Coordinates> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return DEFAULT_ORIGIN;
      }

      // 1. Tenta recuperar a última posição conhecida em cache (retorno instantâneo < 50ms)
      const cached = await Location.getLastKnownPositionAsync();
      if (cached?.coords) {
        return {
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude,
        };
      }

      // 2. Se não houver cache, obtém a posição atual
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
    } catch {
      return DEFAULT_ORIGIN;
    }
  },

  // Calcula a rota de caminhada (pedestre) a partir do destino falado pelo usuário (RF08, RF09)
  async calculateWalkingRoute(spokenDestination: string): Promise<CalculatedRoute> {
    const rawQuery = spokenDestination.trim();
    if (rawQuery.length < 2) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const cleanQuery = cleanVoiceQuery(rawQuery);
    const searchQuery = cleanQuery.length >= 2 ? cleanQuery : rawQuery;

    const origin = await this.getCurrentCoordinates();

    // 1. Se a chave da API do Google Maps estiver configurada, utiliza Google Routes/Directions API
    if (this.isGoogleMapsConfigured()) {
      try {
        return await this.fetchGoogleMapsWalkingRoute(origin, searchQuery, rawQuery);
      } catch (error) {
        console.warn('[MapsService] Falha na Google API, tentando OpenStreetMap:', error);
      }
    }

    // 2. Busca via OpenStreetMap (Nominatim c/ viés de proximidade + OSRM Foot consolidado)
    return await this.fetchOsmWalkingRoute(origin, searchQuery, rawQuery);
  },

  // Consulta oficial à API do Google Maps
  async fetchGoogleMapsWalkingRoute(
    origin: Coordinates,
    destinationQuery: string,
    displayLabel: string
  ): Promise<CalculatedRoute> {
    try {
      const routesV2Url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
      const v2Response = await fetch(routesV2Url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,routes.legs.endLocation,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.legs.steps.endLocation',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: origin.latitude, longitude: origin.longitude },
            },
          },
          destination: {
            address: destinationQuery,
          },
          travelMode: 'WALK',
          languageCode: 'pt-BR',
          units: 'METRIC',
        }),
      });

      if (v2Response.ok) {
        const v2Data = await v2Response.json();
        if (v2Data.routes?.length) {
          const route = v2Data.routes[0];
          const leg = route.legs?.[0] || {};
          const totalMeters = route.distanceMeters || 350;
          const totalSec = parseInt(String(route.duration || '300s').replace('s', ''), 10) || 300;

          const steps: RouteStep[] = (leg.steps || []).map((step: any) => {
            const dist = step.distanceMeters || 50;
            const sec = parseInt(String(step.staticDuration || '60s').replace('s', ''), 10) || 60;
            const rawInstr =
              step.navigationInstruction?.instructions || 'Siga em frente pela calçada';
            const maneuverRaw = (step.navigationInstruction?.maneuver || '').toLowerCase();

            return {
              instruction: stripHtmlTags(rawInstr),
              distanceText: formatDistance(dist),
              distanceMeters: dist,
              durationText: formatDuration(sec),
              maneuver: maneuverRaw.includes('left')
                ? 'turn-left'
                : maneuverRaw.includes('right')
                ? 'turn-right'
                : 'straight',
              endLocation: step.endLocation?.latLng
                ? {
                    latitude: step.endLocation.latLng.latitude,
                    longitude: step.endLocation.latLng.longitude,
                  }
                : undefined,
            };
          });

          return {
            destinationName: displayLabel,
            destinationAddress: destinationQuery,
            origin,
            destination: leg.endLocation?.latLng
              ? {
                  latitude: leg.endLocation.latLng.latitude,
                  longitude: leg.endLocation.latLng.longitude,
                }
              : { latitude: origin.latitude + 0.002, longitude: origin.longitude + 0.002 },
            totalDistanceText: formatDistance(totalMeters),
            totalDistanceMeters: totalMeters,
            totalDurationText: formatDuration(totalSec),
            totalDurationSeconds: totalSec,
            steps:
              steps.length > 0
                ? steps
                : [
                    {
                      instruction: 'Siga em frente até o destino',
                      distanceText: formatDistance(totalMeters),
                      distanceMeters: totalMeters,
                      durationText: formatDuration(totalSec),
                    },
                  ],
            provider: 'GOOGLE_MAPS',
          };
        }
      }
    } catch {
      // Tenta Directions API v1 abaixo
    }

    const originParam = `${origin.latitude},${origin.longitude}`;
    const destParam = encodeURIComponent(destinationQuery);
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originParam}` +
      `&destination=${destParam}` +
      `&mode=walking` +
      `&language=pt-BR` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const leg = data.routes[0].legs[0];
    const steps: RouteStep[] = (leg.steps || []).map((step: any) => ({
      instruction: stripHtmlTags(step.html_instructions || 'Siga em frente'),
      distanceText: step.distance?.text || formatDistance(step.distance?.value || 50),
      distanceMeters: step.distance?.value || 50,
      durationText: step.duration?.text || '1 min',
      maneuver: step.maneuver || 'straight',
      endLocation: step.end_location
        ? { latitude: step.end_location.lat, longitude: step.end_location.lng }
        : undefined,
    }));

    return {
      destinationName: displayLabel,
      destinationAddress: leg.end_address || destinationQuery,
      origin,
      destination: {
        latitude: leg.end_location.lat,
        longitude: leg.end_location.lng,
      },
      totalDistanceText: leg.distance?.text || formatDistance(leg.distance?.value || 350),
      totalDistanceMeters: leg.distance?.value || 350,
      totalDurationText: leg.duration?.text || formatDuration(leg.duration?.value || 300),
      totalDurationSeconds: leg.duration?.value || 300,
      steps:
        steps.length > 0
          ? steps
          : [
              {
                instruction: 'Siga em frente até o destino',
                distanceText: '100 m',
                distanceMeters: 100,
                durationText: '2 min',
              },
            ],
      provider: 'GOOGLE_MAPS',
    };
  },

  // Busca real via OpenStreetMap com Viés Geográfico de Proximidade (Viewbox)
  async fetchOsmWalkingRoute(
    origin: Coordinates,
    destinationQuery: string,
    displayLabel: string
  ): Promise<CalculatedRoute> {
    // 1. Gera uma caixa delimitadora (viewbox) de cerca de 35 km ao redor do usuário
    const delta = 0.35;
    const left = (origin.longitude - delta).toFixed(4);
    const right = (origin.longitude + delta).toFixed(4);
    const top = (origin.latitude + delta).toFixed(4);
    const bottom = (origin.latitude - delta).toFixed(4);
    const viewbox = `${left},${top},${right},${bottom}`;

    // Busca até 6 candidatos priorizando as proximidades imediatas do usuário (bounded=0)
    const geoUrl =
      `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=br` +
      `&viewbox=${viewbox}&bounded=0` +
      `&q=${encodeURIComponent(destinationQuery)}`;

    const geoRes = await fetch(geoUrl, {
      headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'VivaWay-MAT/1.0' },
    });
    const geoData = await geoRes.json();

    if (!Array.isArray(geoData) || geoData.length === 0) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    // 2. Ordena os candidatos encontrados pela menor distância Haversine até o usuário
    const sortedCandidates = geoData
      .map((item: any) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const distanceToUser = mapsService.getDistanceMeters(origin, {
          latitude: lat,
          longitude: lon,
        });
        return { item, lat, lon, distanceToUser };
      })
      .sort((a: any, b: any) => a.distanceToUser - b.distanceToUser);

    const bestMatch = sortedCandidates[0];

    // Se o resultado mais próximo estiver a mais de 35 km, rejeita como rota pedestre
    if (bestMatch.distanceToUser > 35000) {
      throw new Error('DESTINO_MUITO_DISTANTE');
    }

    const destCoords: Coordinates = {
      latitude: bestMatch.lat,
      longitude: bestMatch.lon,
    };

    const foundName =
      (bestMatch.item.name && String(bestMatch.item.name).trim()) ||
      String(bestMatch.item.display_name || displayLabel).split(',')[0].trim();

    // 3. Traçado de rota pedestre via OSRM Foot com coordenadas ordenadas
    const osrmUrl =
      `https://router.project-osrm.org/route/v1/foot/` +
      `${origin.longitude},${origin.latitude};${destCoords.longitude},${destCoords.latitude}` +
      `?overview=false&steps=true`;

    const routeRes = await fetch(osrmUrl);
    const routeData = await routeRes.json();

    if (routeData.code !== 'Ok' || !routeData.routes?.length) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const osrmRoute = routeData.routes[0];
    const osrmLeg = osrmRoute.legs[0];
    const totalMeters = Math.round(osrmRoute.distance || 0);
    if (totalMeters <= 0) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const walkingSeconds = Math.round(totalMeters / 1.15); // ~4.1 km/h velocidade pedestre
    const rawSteps = osrmLeg.steps || [];

    // 4. Consolida os micro-segmentos geométricos em instruções claras de navegação
    const consolidatedSteps = consolidateOsrmSteps(rawSteps, destCoords, foundName);

    return {
      destinationName: foundName,
      destinationAddress: bestMatch.item.display_name || destinationQuery,
      origin,
      destination: destCoords,
      totalDistanceText: formatDistance(totalMeters),
      totalDistanceMeters: totalMeters,
      totalDurationText: formatDuration(walkingSeconds),
      totalDurationSeconds: walkingSeconds,
      steps:
        consolidatedSteps.length > 0
          ? consolidatedSteps
          : [
              {
                instruction: `Siga em frente até ${foundName}`,
                distanceText: formatDistance(totalMeters),
                distanceMeters: totalMeters,
                durationText: formatDuration(walkingSeconds),
                maneuver: 'straight',
                endLocation: destCoords,
              },
            ],
      provider: 'OSM_FALLBACK',
    };
  },
};
