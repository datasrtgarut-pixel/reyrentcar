import React, { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map as GoogleMapView,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, MapPin, Navigation } from 'lucide-react';
import type { EmployeeLocation, TrackingPoint } from '../types/app';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_CENTER = { lat: -6.2088, lng: 106.8456 }; // Jakarta WIB

export interface MapMarkerItem {
  id: string;
  title: string;
  subtitle?: string;
  lat: number;
  lng: number;
  isTracking?: boolean;
  isOnline?: boolean;
  accuracy?: number;
  address?: string;
  lastUpdatedWib?: string;
  mockSuspected?: boolean;
  badgeType?: 'start' | 'end' | 'employee';
}

interface PolylineOverlayProps {
  points: TrackingPoint[];
}

const PolylineOverlay: React.FC<PolylineOverlayProps> = ({ points }) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !mapsLib || !coreLib || points.length < 2) return;

    const path = points.map((p) => ({ lat: p.lat, lng: p.lng }));
    const polyline = new mapsLib.Polyline({
      path,
      geodesic: true,
      strokeColor: '#D4AF37',
      strokeOpacity: 0.95,
      strokeWeight: 4,
    });
    polyline.setMap(map);

    const bounds = new coreLib.LatLngBounds();
    path.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, 48);

    return () => {
      polyline.setMap(null);
    };
  }, [map, mapsLib, coreLib, points]);

  return null;
};

interface MarkerWithPopupProps {
  item: MapMarkerItem;
}

const MarkerWithPopup: React.FC<MarkerWithPopupProps> = ({ item }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);

  const badgeBg =
    item.badgeType === 'start'
      ? 'bg-emerald-600 border-emerald-300 text-white'
      : item.badgeType === 'end'
      ? 'bg-red-600 border-red-300 text-white'
      : item.isTracking
      ? 'bg-[#D4AF37] border-[#FFF3C4] text-[#0B0B0D]'
      : item.isOnline
      ? 'bg-[#18181D] border-[#D4AF37] text-[#F6E08B]'
      : 'bg-zinc-800 border-zinc-500 text-zinc-200';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: item.lat, lng: item.lng }}
        onClick={() => setOpen(true)}
        title={item.title}
      >
        <div className="flex flex-col items-center cursor-pointer group">
          <div
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold shadow-lg whitespace-nowrap transition-transform group-hover:scale-105 ${badgeBg}`}
          >
            {item.title}
          </div>
          <div className="w-2.5 h-2.5 rotate-45 -mt-1.5 bg-[#D4AF37] border-r border-b border-black/40" />
        </div>
      </AdvancedMarker>

      {open && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} maxWidth={260}>
          <div className="p-1 text-zinc-900 text-xs space-y-1">
            <div className="font-bold text-sm text-zinc-950">{item.title}</div>
            {item.subtitle && <div className="text-zinc-600 font-medium">{item.subtitle}</div>}
            {item.address && <div className="text-zinc-700 leading-snug">{item.address}</div>}
            <div className="font-mono text-[11px] text-zinc-500">
              {item.lat.toFixed(6)}, {item.lng.toFixed(6)}
              {item.accuracy ? ` (±${item.accuracy}m)` : ''}
            </div>
            {item.lastUpdatedWib && (
              <div className="text-[11px] text-zinc-600">Pembaruan: {item.lastUpdatedWib}</div>
            )}
            {item.mockSuspected && (
              <div className="text-[11px] font-semibold text-red-600">
                Peringatan: Indikasi lokasi palsu terdeteksi
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface GoogleMapViewerProps {
  markers: MapMarkerItem[];
  routePoints?: TrackingPoint[];
  heightClass?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
}

export const GoogleMapViewer: React.FC<GoogleMapViewerProps> = ({
  markers,
  routePoints = [],
  heightClass = 'h-[360px]',
  center,
  zoom = 13,
}) => {
  const effectiveCenter =
    center ||
    (markers.length > 0
      ? { lat: markers[0].lat, lng: markers[0].lng }
      : routePoints.length > 0
      ? { lat: routePoints[0].lat, lng: routePoints[0].lng }
      : DEFAULT_CENTER);

  if (!MAPS_API_KEY) {
    return (
      <div
        className={`w-full ${heightClass} rounded-2xl border border-[#D4AF37]/30 bg-[#121216] flex flex-col items-center justify-center p-6 text-center`}
      >
        <AlertTriangle className="w-8 h-8 text-[#D4AF37] mb-2" />
        <p className="text-sm font-semibold text-[#F6E08B]">Google Maps API Key Belum Terpasang</p>
        <p className="mt-1 text-xs text-zinc-400 max-w-md">
          Tambahkan <code className="text-zinc-200">VITE_GOOGLE_MAPS_API_KEY</code> pada environment untuk menampilkan peta interaktif.
        </p>
      </div>
    );
  }

  return (
    <div className={`w-full ${heightClass} rounded-2xl overflow-hidden border border-zinc-800 bg-[#121216] relative`}>
      <APIProvider apiKey={MAPS_API_KEY} language="id" region="ID" libraries={['marker']}>
        <GoogleMapView
          mapId="DEMO_MAP_ID"
          defaultCenter={effectiveCenter}
          center={center}
          defaultZoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {markers.map((m) => (
            <MarkerWithPopup key={m.id} item={m} />
          ))}
          {routePoints.length > 1 && <PolylineOverlay points={routePoints} />}
        </GoogleMapView>
      </APIProvider>

      {markers.length === 0 && routePoints.length === 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-[#0B0B0D]/85 px-3 py-1.5 text-xs text-zinc-300 border border-zinc-800">
          <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span>Menunggu titik GPS aktif dari pegawai</span>
        </div>
      )}
    </div>
  );
};

export function locationsToMarkers(locations: EmployeeLocation[]): MapMarkerItem[] {
  return locations.map((loc) => ({
    id: loc.employeeId,
    title: loc.employeeName,
    subtitle: loc.isTracking
      ? 'Sedang Dalam Perjalanan'
      : loc.isOnline
      ? 'Online'
      : 'Offline / Terakhir Terpantau',
    lat: loc.lat,
    lng: loc.lng,
    isTracking: loc.isTracking,
    isOnline: loc.isOnline,
    accuracy: loc.accuracy,
    address: loc.address,
    lastUpdatedWib: loc.lastUpdatedWib,
    mockSuspected: loc.mockSuspected,
    badgeType: 'employee',
  }));
}

export const MapLegendBadge: React.FC = () => (
  <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
    <span className="inline-flex items-center gap-1.5">
      <Navigation className="w-3.5 h-3.5 text-[#D4AF37]" />
      <span>Emas: Sedang Dalam Perjalanan</span>
    </span>
    <span className="inline-flex items-center gap-1.5">
      <MapPin className="w-3.5 h-3.5 text-zinc-200" />
      <span>Hitam/Emas: Online</span>
    </span>
    <span className="inline-flex items-center gap-1.5">
      <MapPin className="w-3.5 h-3.5 text-zinc-500" />
      <span>Abu-abu: Offline / Terakhir</span>
    </span>
  </div>
);
