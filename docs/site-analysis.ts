export type FactorKey = 'climate' | 'renewables' | 'water';

export type MetricKey =
  | 'mean_air_temperature'
  | 'annual_solar'
  | 'wind_100m'
  | 'scoring_water_proximity'
  | 'mapped_water_sample';

export interface LocationAnalysis {
  id: string;
  name: string;
  region: string;
  coordinatesSource: 'exact' | 'regional_reference';
  coordinates: { latitude: number; longitude: number };
  score: {
    total: number | null;
    rank: number | null;
    ofTotal: number | null;
    factors: Array<{
      key: FactorKey;
      label: string;
      score: number | null;
      weight: number | null;
      contribution: number | null;
    }>;
  };
  metrics: Array<{
    key: MetricKey;
    value: number | null;
    unit: '°C' | 'kWh/m²/yr' | 'm/s' | 'km';
    displayValue: string;
  }>;
  trend: {
    slopePerDecade: number | null;
    slope95CI: [number, number] | null;
    isSignificant: boolean | null;
    significanceBasis: 'unadjusted' | 'fdr' | null;
    pValue: number | null;
    pAdjusted: number | null;
  };
}
