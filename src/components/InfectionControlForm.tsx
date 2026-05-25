export interface InfectionControlValue {
  hasFever: boolean;
  temperature: string;
  hasAcuteCough: boolean;
}

export const defaultInfectionControlValue: InfectionControlValue = {
  hasFever: false,
  temperature: '',
  hasAcuteCough: false,
};

export function validateInfectionControlValue(value: InfectionControlValue): string | null {
  if (!value.hasFever) {
    return null;
  }

  const temperature = Number(value.temperature);
  if (!value.temperature || !Number.isFinite(temperature)) {
    return '選擇有發燒時，請輸入體溫數值';
  }

  if (temperature < 37.5 || temperature > 43) {
    return '發燒體溫需介於 37.5°C 至 43.0°C';
  }

  return null;
}

export function toInfectionControlPayload(value: InfectionControlValue) {
  return {
    hasFever: value.hasFever,
    temperature: value.hasFever ? Number(value.temperature) : null,
    hasAcuteCough: value.hasAcuteCough,
  };
}

interface InfectionControlFormProps {
  value: InfectionControlValue;
  onChange: (value: InfectionControlValue) => void;
}

export default function InfectionControlForm({ value, onChange }: InfectionControlFormProps) {
  const error = validateInfectionControlValue(value);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-gray-900">
      <div className="mb-3">
        <h3 className="text-base font-bold text-gray-900">感染管控聲明</h3>
        <p className="mt-1 text-sm text-gray-700">
          請於每次上、下班打卡前確認，預設為「無」。
        </p>
      </div>

      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-900">是否有發燒</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
              !value.hasFever
                ? 'border-green-500 bg-green-50 text-green-900'
                : 'border-gray-300 bg-white text-gray-900'
            }`}>
              <input
                type="radio"
                name="infection-fever"
                checked={!value.hasFever}
                onChange={() => onChange({ ...value, hasFever: false, temperature: '' })}
                className="h-4 w-4 text-green-600"
              />
              無
            </label>
            <label className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
              value.hasFever
                ? 'border-red-500 bg-red-50 text-red-900'
                : 'border-gray-300 bg-white text-gray-900'
            }`}>
              <input
                type="radio"
                name="infection-fever"
                checked={value.hasFever}
                onChange={() => onChange({ ...value, hasFever: true })}
                className="h-4 w-4 text-red-600"
              />
              有
            </label>
          </div>
        </fieldset>

        {value.hasFever && (
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-900">
              體溫數值（°C）
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="37.5"
              max="43"
              step="0.1"
              value={value.temperature}
              onChange={(event) => onChange({ ...value, temperature: event.target.value })}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-black focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：37.8"
            />
            {error && <p className="mt-1 text-sm font-medium text-red-700">{error}</p>}
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-900">
            是否有急性咳嗽≧24小時
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
              !value.hasAcuteCough
                ? 'border-green-500 bg-green-50 text-green-900'
                : 'border-gray-300 bg-white text-gray-900'
            }`}>
              <input
                type="radio"
                name="infection-cough"
                checked={!value.hasAcuteCough}
                onChange={() => onChange({ ...value, hasAcuteCough: false })}
                className="h-4 w-4 text-green-600"
              />
              無
            </label>
            <label className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
              value.hasAcuteCough
                ? 'border-red-500 bg-red-50 text-red-900'
                : 'border-gray-300 bg-white text-gray-900'
            }`}>
              <input
                type="radio"
                name="infection-cough"
                checked={value.hasAcuteCough}
                onChange={() => onChange({ ...value, hasAcuteCough: true })}
                className="h-4 w-4 text-red-600"
              />
              有
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
