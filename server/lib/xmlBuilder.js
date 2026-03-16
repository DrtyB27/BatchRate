const { create } = require('xmlbuilder2');

/**
 * Builds a 3G TMS Rating API XML request for a single shipment lane.
 */
function buildRateRequestXml(row, contractNumber) {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('RateRequest')
      .ele('Contract').txt(contractNumber).up()
      .ele('Shipment')
        .ele('Origin')
          .ele('PostalCode').txt(row.origin_zip).up()
          .ele('Country').txt('US').up()
        .up()
        .ele('Destination')
          .ele('PostalCode').txt(row.dest_zip).up()
          .ele('Country').txt('US').up()
        .up()
        .ele('Items')
          .ele('Item')
            .ele('Weight').txt(row.weight_lbs).up()
            .ele('WeightUOM').txt('LBS').up()
            .ele('FreightClass').txt(row.freight_class).up()
            .ele('Pieces').txt(row.pieces).up()
          .up()
        .up()
      .up()
    .up();

  return doc.end({ prettyPrint: true });
}

module.exports = { buildRateRequestXml };
