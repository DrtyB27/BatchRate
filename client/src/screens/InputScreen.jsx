import React, { useState, useCallback } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';
import { buildRatingRequest } from '../services/xmlBuilder.js';
import { postToG3, applyMargin, sleep } from '../services/ratingClient.js';
import { parseRatingResponse } from '../services/xmlParser.js';

export default function InputScreen({ credentials, onBatchStart, onResultRow }) {
  // Inherit session-level settings from credentials screen
  const [params, setParams] = useState({
    contRef: credentials.contRef || '',
    contractStatus: credentials.contractStatus || 'BeingEntered',
    clientTPNum: credentials.clientTPNum || '',
    carrierTPNum: credentials.carrierTPNum || '',
    skipSafety: true,
    contractUse: credentials.contractUse || ['ClientCost'],
    useRoutingGuides: false,
    forceRoutingGuideName: '',
    numberOfRates: 4,
    showTMSMarkup: false,
    margins: [],
    saveRequestXml: true,
    saveResponseXml: true,
  });
  const [csvRows, setCsvRows] = useState(null);
  const [running, setRunning] = useState(false);

  const handleDataLoaded = useCallback((rows) => setCsvRows(rows), []);
  const handleClear = useCallback(() => setCsvRows(null), []);

  const handleRunBatch = async () => {
    if (!csvRows || csvRows.length === 0) return;
    setRunning(true);

    onBatchStart(params, csvRows.length);

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const startTime = Date.now();
      let result;

      try {
        const xml = buildRatingRequest(row, params, credentials);
        const responseXml = await postToG3(xml, credentials);
        const parsed = parseRatingResponse(responseXml);
        const elapsedMs = Date.now() - startTime;

        const ratesWithMargin = parsed.rates.map(rate => {
          const { customerPrice, marginType, marginValue } = applyMargin(rate.totalCharge, rate.carrierSCAC, params.margins);
          return { ...rate, marginType, marginValue, customerPrice };
        });

        result = {
          rowIndex: i,
          reference: row['Reference'] || '',
          origCity: row['Orig City'] || '',
          origState: row['Org State'] || '',
          origPostal: row['Org Postal Code'] || '',
          origCountry: row['Orig Cntry'] || 'US',
          destCity: row['DstCity'] || '',
          destState: row['Dst State'] || '',
          destPostal: row['Dst Postal Code'] || '',
          destCountry: row['Dst Cntry'] || 'US',
          inputClass: row['Class'] || '',
          inputNetWt: row['Net Wt Lb'] || '',
          inputPcs: row['Pcs'] || '',
          inputHUs: row['Ttl HUs'] || '',
          pickupDate: row['Pickup Date'] || '',
          contRef: row['Cont. Ref'] || params.contRef || '',
          clientTPNum: row['Client TP Num'] || params.clientTPNum || '',
          historicCarrier: row['Historic Carrier'] || '',
          historicCost: parseFloat(row['Historic Cost']) || 0,
          success: parsed.rates.length > 0,
          ratingMessage: parsed.ratingMessage,
          elapsedMs,
          rateRequestXml: params.saveRequestXml ? xml : '',
          rateResponseXml: params.saveResponseXml ? responseXml : '',
          rates: ratesWithMargin,
        };
      } catch (err) {
        const elapsedMs = Date.now() - startTime;
        result = {
          rowIndex: i,
          reference: row['Reference'] || '',
          origCity: row['Orig City'] || '',
          origState: row['Org State'] || '',
          origPostal: row['Org Postal Code'] || '',
          origCountry: row['Orig Cntry'] || 'US',
          destCity: row['DstCity'] || '',
          destState: row['Dst State'] || '',
          destPostal: row['Dst Postal Code'] || '',
          destCountry: row['Dst Cntry'] || 'US',
          inputClass: row['Class'] || '',
          inputNetWt: row['Net Wt Lb'] || '',
          inputPcs: row['Pcs'] || '',
          inputHUs: row['Ttl HUs'] || '',
          pickupDate: row['Pickup Date'] || '',
          contRef: row['Cont. Ref'] || params.contRef || '',
          clientTPNum: row['Client TP Num'] || params.clientTPNum || '',
          historicCarrier: row['Historic Carrier'] || '',
          historicCost: parseFloat(row['Historic Cost']) || 0,
          success: false,
          ratingMessage: err.message,
          elapsedMs,
          rateRequestXml: '',
          rateResponseXml: '',
          rates: [],
        };
      }

      onResultRow(result);

      // 150ms delay between requests
      if (i < csvRows.length - 1) {
        await sleep(150);
      }
    }

    setRunning(false);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <ParametersSidebar params={params} setParams={setParams} />

      <main className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Batch Rate Input</h2>
          <button
            onClick={handleRunBatch}
            disabled={!csvRows || csvRows.length === 0 || running}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2 rounded-md transition-colors text-sm"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Running...
              </span>
            ) : 'Run Batch'}
          </button>
        </div>

        <CsvDropzone onDataLoaded={handleDataLoaded} onClear={handleClear} />
      </main>
    </div>
  );
}
