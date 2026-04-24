export type NetSuiteObjectType = 'customrecord' | 'customfield' | 'customlist' | 'customsegment';

export interface SDFMapping {
  id: string; // Internal mapping ID
  questionId: string;
  triggerValue: any;
  output: {
    type: NetSuiteObjectType;
    scriptid: string;
    template: string;
  };
}

export const SDF_MAPPING_REGISTRY: SDFMapping[] = [

  // ─── R2R: Segmentation ───────────────────────────────────────────────────────

  {
    id: 'r2r-department-segment',
    questionId: 'r2r.segmentation.useDepartments',
    triggerValue: true,
    output: {
      type: 'customsegment',
      scriptid: 'cseg_nsix_department',
      template: `
        <customsegment scriptid="cseg_nsix_department">
          <label>Department</label>
          <description>NSIX-managed department segment for financial reporting.</description>
          <filteredbyallvalues>F</filteredbyallvalues>
          <isrequired>F</isrequired>
          <fieldtype>SELECT</fieldtype>
        </customsegment>
      `,
    },
  },

  {
    id: 'r2r-class-segment',
    questionId: 'r2r.segmentation.useClasses',
    triggerValue: true,
    output: {
      type: 'customsegment',
      scriptid: 'cseg_nsix_class',
      template: `
        <customsegment scriptid="cseg_nsix_class">
          <label>Class</label>
          <description>NSIX-managed class segment for business unit or product line tracking.</description>
          <filteredbyallvalues>F</filteredbyallvalues>
          <isrequired>F</isrequired>
          <fieldtype>SELECT</fieldtype>
        </customsegment>
      `,
    },
  },

  {
    id: 'r2r-location-segment',
    questionId: 'r2r.segmentation.useLocations',
    triggerValue: true,
    output: {
      type: 'customsegment',
      scriptid: 'cseg_nsix_location',
      template: `
        <customsegment scriptid="cseg_nsix_location">
          <label>Location</label>
          <description>NSIX-managed location segment for warehouse and office tracking.</description>
          <filteredbyallvalues>F</filteredbyallvalues>
          <isrequired>F</isrequired>
          <fieldtype>SELECT</fieldtype>
        </customsegment>
      `,
    },
  },

  {
    id: 'r2r-je-approval-field',
    questionId: 'r2r.journalEntries.approvalRequired',
    triggerValue: true,
    output: {
      type: 'customfield',
      scriptid: 'custbody_nsix_je_approval_status',
      template: `
<transactionbodycustomfield scriptid="custbody_nsix_je_approval_status">
  <label>JE Approval Status</label>
  <fieldtype>SELECT</fieldtype>
  <selectrecordtype>-224</selectrecordtype>
  <appliestojournal>T</appliestojournal>
</transactionbodycustomfield>
      `,
    },
  },

  // ─── MFG: Production flow ────────────────────────────────────────────────────

  {
    id: 'mfg-wip-record',
    questionId: 'mfg.productionFlow.type',
    triggerValue: 'WIP_ROUTINGS',
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_wip_log',
      template: `
<customrecordtype scriptid="customrecord_nsix_wip_log">
  <recordname>NSIX WIP Log</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

  // ─── P2P: Purchasing ─────────────────────────────────────────────────────────

  {
    id: 'p2p-po-approval-record',
    questionId: 'p2p.purchasing.poApprovalRequired',
    triggerValue: true,
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_po_approval_log',
      template: `
<customrecordtype scriptid="customrecord_nsix_po_approval_log">
  <recordname>NSIX PO Approval Log</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

  {
    id: 'p2p-purchase-requisition-record',
    questionId: 'p2p.purchasing.purchaseRequisitions',
    triggerValue: true,
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_purchase_req',
      template: `
<customrecordtype scriptid="customrecord_nsix_purchase_req">
  <recordname>NSIX Purchase Requisition</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

  {
    id: 'p2p-three-way-match-field',
    questionId: 'p2p.receiving.threeWayMatch',
    triggerValue: true,
    output: {
      type: 'customfield',
      scriptid: 'custbody_nsix_three_way_match_status',
      template: `
<transactionbodycustomfield scriptid="custbody_nsix_three_way_match_status">
  <label>3-Way Match Status</label>
  <fieldtype>SELECT</fieldtype>
  <selectrecordtype>-224</selectrecordtype>
  <appliestopurchaseorder>T</appliestopurchaseorder>
</transactionbodycustomfield>
      `,
    },
  },

  {
    id: 'p2p-expense-report-record',
    questionId: 'p2p.expenses.employeeExpenses',
    triggerValue: true,
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_expense_report',
      template: `
<customrecordtype scriptid="customrecord_nsix_expense_report">
  <recordname>NSIX Expense Report</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

  // ─── O2C: Customers & Pricing ────────────────────────────────────────────────

  {
    id: 'o2c-credit-limit-field',
    questionId: 'o2c.customers.creditLimits',
    triggerValue: true,
    output: {
      type: 'customfield',
      scriptid: 'custentity_nsix_credit_approval_req',
      template: `
        <entitycustomfield scriptid="custentity_nsix_credit_approval_req">
          <appliestocustomer>T</appliestocustomer>
          <description>Flag indicating this customer requires credit approval before order fulfilment.</description>
          <fieldtype>CHECKBOX</fieldtype>
          <label>Credit Approval Required</label>
        </entitycustomfield>
      `,
    },
  },

  {
    id: 'o2c-price-level-list',
    questionId: 'o2c.pricing.multiplePriceLevels',
    triggerValue: true,
    output: {
      type: 'customlist',
      scriptid: 'customlist_nsix_price_levels',
      // Phase 4 shape note: <label> replaces the invalid <name>; the list
      // is only emitted when <customvalues> has at least one entry —
      // sdfGenerator.ts handles the skip. The wizard does not yet collect
      // values, so today this mapping always lands in pendingListValues and
      // the BRD generator asks the consultant to fill them in.
      template: `
<customlist scriptid="customlist_nsix_price_levels">
  <label>NSIX Price Levels</label>
  <description>NSIX-managed list of configured price levels for customer pricing tiers.</description>
  <customvalues>
  </customvalues>
</customlist>
      `,
    },
  },

  // ─── O2C: Invoicing & Revenue ─────────────────────────────────────────────

  {
    id: 'o2c-revenue-recognition-record',
    questionId: 'o2c.invoicing.revenueRecognition',
    triggerValue: true,
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_rev_rec_schedule',
      template: `
<customrecordtype scriptid="customrecord_nsix_rev_rec_schedule">
  <recordname>NSIX Revenue Recognition Schedule</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

  // ─── O2C: Collections ────────────────────────────────────────────────────────

  {
    id: 'o2c-dunning-schedule-record',
    questionId: 'o2c.collections.dunningLetters',
    triggerValue: true,
    output: {
      type: 'customrecord',
      scriptid: 'customrecord_nsix_dunning_schedule',
      template: `
<customrecordtype scriptid="customrecord_nsix_dunning_schedule">
  <recordname>NSIX Dunning Schedule</recordname>
  <customrecordcustomfields>
  </customrecordcustomfields>
</customrecordtype>
      `,
    },
  },

];

export function getMappingsForAnswers(answers: Record<string, any>): SDFMapping[] {
  return SDF_MAPPING_REGISTRY.filter(m => answers[m.questionId] === m.triggerValue);
}
