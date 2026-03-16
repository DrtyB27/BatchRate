import React from 'react';

export default function ExportWarningModal({ type, onConfirm, onCancel }) {
  const isCustomRate = type === 'customRate';
  const isCustomer = type === 'customer';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
        {isCustomer && (
          <>
            <h3 className="text-lg font-bold text-gray-800 mb-3">Customer Export Confirmation</h3>
            <p className="text-sm text-gray-600 mb-4">
              This export contains customer-facing prices with margin applied.
              Verify all carrier margins are correct before sharing externally.
            </p>
          </>
        )}

        {isCustomRate && (
          <>
            <h3 className="text-lg font-bold text-amber-700 mb-3">Review Required Before Importing to 3G TMS</h3>
            <p className="text-sm text-gray-600 mb-2">
              The following fields are blank and <strong>MUST</strong> be completed before import:
            </p>
            <ul className="text-sm text-gray-700 mb-3 space-y-1.5 ml-4">
              <li className="list-disc">
                <strong>customRate.name</strong><br />
                <span className="text-xs text-gray-500">Governance naming: CustomAbbv -- SCAC -- EffectiveDate - Notation</span>
              </li>
              <li className="list-disc"><strong>effectiveDate</strong></li>
              <li className="list-disc"><strong>expirationDate</strong></li>
            </ul>
            <p className="text-sm text-gray-600 mb-1">Also verify before import:</p>
            <ul className="text-sm text-gray-700 mb-4 space-y-1 ml-4">
              <li className="list-disc">Discount decimal format (0.690 vs 69.0) — validate against a live 3G export</li>
              <li className="list-disc">TIER 2 HITL approval required before activating any contract in 3G TMS</li>
            </ul>
          </>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm text-white rounded-md font-medium ${
              isCustomRate ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isCustomRate ? 'Download Anyway' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
