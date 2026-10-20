import * as Location from 'expo-location';
import { CalculatedRoute, Coordinates, RouteStep } from '../types/mat';

// Lê a chave da API do Google Maps configurada no arquivo .env
const GOOGLE_MAPS_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();

// Coordenadas padrão de fallback (Campinas-SP) caso o GPS esteja desativado
const DEFAULT_ORIGIN: Coordinates = {
  latitude: -22.8171,
  longitude: -47.0697,
};

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

  // Obtém a localização de GPS atual do smartphone (ou fallback seguro em emuladores)
  async getCurrentCoordinates(): Promise<Coordinates> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return DEFAULT_ORIGIN;
      }
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
  // Caso o destino não exista ou não seja identificado, lança erro 'DESTINO_NAO_IDENTIFICADO'
  async calculateWalkingRoute(spokenDestination: string): Promise<CalculatedRoute> {
    const searchQuery = spokenDestination.trim();
    if (searchQuery.length < 2) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const origin = await this.getCurrentCoordinates();

    // 1. Se a chave da API do Google Maps estiver configurada, utiliza Google Routes/Directions API
    if (this.isGoogleMapsConfigured()) {
      try {
        return await this.fetchGoogleMapsWalkingRoute(origin, searchQuery, searchQuery);
      } catch (error) {
        console.warn('[MapsService] Falha na Google API, tentando OpenStreetMap:', error);
      }
    }

    // 2. Busca real via OpenStreetMap (Nominatim + OSRM Foot) sem inventar destino padrão
    return await this.fetchOsmWalkingRoute(origin, searchQuery, searchQuery);
  },

  // Consulta oficial à API do Google Maps (compatível com Routes API v2 e Directions API, mode=walking, pt-BR)
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

  // Busca real via OpenStreetMap (Nominatim Geocoding + OSRM Foot Routing)
  // Se o endereço não for encontrado no mapa, lança erro 'DESTINO_NAO_IDENTIFICADO'
  async fetchOsmWalkingRoute(
    origin: Coordinates,
    destinationQuery: string,
    displayLabel: string
  ): Promise<CalculatedRoute> {
    const geoUrl =
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br` +
      `&q=${encodeURIComponent(destinationQuery)}`;
    const geoRes = await fetch(geoUrl, {
      headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'AppMAT-DLEI2026/1.0' },
    });
    const geoData = await geoRes.json();

    if (!Array.isArray(geoData) || geoData.length === 0) {
      throw new Error('DESTINO_NAO_IDENTIFICADO');
    }

    const destCoords: Coordinates = {
      latitude: parseFloat(geoData[0].lat),
      longitude: parseFloat(geoData[0].lon),
    };

    const foundName =
      (geoData[0].name && String(geoData[0].name).trim()) ||
      String(geoData[0].display_name || displayLabel).split(',')[0].trim();

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

    const walkingSeconds = Math.round(totalMeters / 1.1);

    const rawSteps = osrmLeg.steps || [];
    const steps: RouteStep[] = rawSteps.map((s: any, idx: number) => {
      const dist = Math.round(s.distance || 40);
      const streetName = s.name ? ` pela ${s.name}` : '';
      const modifier = s.maneuver?.modifier || '';
      let action = 'Siga em frente';
      if (modifier.includes('left')) action = 'Vire à esquerda';
      else if (modifier.includes('right')) action = 'Vire à direita';
      else if (idx === rawSteps.length - 1) action = 'Você chegou ao destino';

      // O fim do passo atual corresponde ao ponto de manobra do próximo passo (ou o destino final)
      const nextStepLoc = rawSteps[idx + 1]?.maneuver?.location;
      const stepEndCoords: Coordinates =
        Array.isArray(nextStepLoc) && nextStepLoc.length >= 2
          ? { latitude: Number(nextStepLoc[1]), longitude: Number(nextStepLoc[0]) }
          : destCoords;

      return {
        instruction: `${action}${streetName} por ${formatDistance(dist)}`,
        distanceText: formatDistance(dist),
        distanceMeters: dist,
        durationText: formatDuration(dist / 1.1),
        maneuver: modifier.includes('left')
          ? 'turn-left'
          : modifier.includes('right')
          ? 'turn-right'
          : 'straight',
        endLocation: stepEndCoords,
      };
    });

    return {
      destinationName: foundName,
      destinationAddress: geoData[0].display_name || destinationQuery,
      origin,
      destination: destCoords,
      totalDistanceText: formatDistance(totalMeters),
      totalDistanceMeters: totalMeters,
      totalDurationText: formatDuration(walkingSeconds),
      totalDurationSeconds: walkingSeconds,
      steps:
        steps.length > 0
          ? steps
          : [
              {
                instruction: `Siga em frente até ${foundName}`,
                distanceText: formatDistance(totalMeters),
                distanceMeters: totalMeters,
                durationText: formatDuration(walkingSeconds),
                maneuver: 'straight',
              },
            ],
      provider: 'OSM_FALLBACK',
    };
  },
};
