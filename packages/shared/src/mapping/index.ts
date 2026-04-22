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
        <othercustomfield scriptid="custbody_nsix_je_approval_status">
          <appliestojournal>T</appliestojournal>
          <description>Tracks approval status for journal entries requiring authorization.</description>
          <fieldtype>SELECT</fieldtype>
          <label>JE Approval Status</label>
          <selectrecordtype>-224</selectrecordtype>
        </othercustomfield>
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
        <customrecord scriptid="customrecord_nsix_wip_log">
          <description>Log for WIP activities triggered by WIP_ROUTINGS production flow.</description>
          <iconbase64></iconbase64>
          <isordered>T</isordered>
          <recordname>NSIX WIP Log</recordname>
        </customrecord>
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
        <customrecord scriptid="customrecord_nsix_po_approval_log">
          <description>Tracks PO approval workflow steps and approver decisions.</description>
          <isordered>F</isordered>
          <recordname>NSIX PO Approval Log</recordname>
        </customrecord>
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
        <customrecord scriptid="customrecord_nsix_purchase_req">
          <description>Purchase requisition record for pre-PO approval workflows.</description>
          <isordered>T</isordered>
          <recordname>NSIX Purchase Requisition</recordname>
        </customrecord>
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
        <othercustomfield scriptid="custbody_nsix_three_way_match_status">
          <appliestopurchaseorder>T</appliestopurchaseorder>
          <description>Indicates whether a PO has completed 3-way matching (PO, receipt, invoice).</description>
          <fieldtype>SELECT</fieldtype>
          <label>3-Way Match Status</label>
          <selectrecordtype>-224</selectrecordtype>
        </othercustomfield>
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
        <customrecord scriptid="customrecord_nsix_expense_report">
          <description>Employee expense report record for capturing and approving staff expense claims.</description>
          <isordered>T</isordered>
          <recordname>NSIX Expense Report</recordname>
        </customrecord>
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
      template: `
        <customlist scriptid="customlist_nsix_price_levels">
          <description>NSIX-managed list of configured price levels for customer pricing tiers.</description>
          <name>NSIX Price Levels</name>
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
        <customrecord scriptid="customrecord_nsix_rev_rec_schedule">
          <description>Revenue recognition schedule for deferred income tracking and recognition events.</description>
          <isordered>T</isordered>
          <recordname>NSIX Revenue Recognition Schedule</recordname>
        </customrecord>
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
        <customrecord scriptid="customrecord_nsix_dunning_schedule">
          <description>Dunning schedule configuration record defining letter timing, escalation levels, and messaging for overdue AR.</description>
          <isordered>T</isordered>
          <recordname>NSIX Dunning Schedule</recordname>
        </customrecord>
      `,
    },
  },

];

export function getMappingsForAnswers(answers: Record<string, any>): SDFMapping[] {
  return SDF_MAPPING_REGISTRY.filter(m => answers[m.questionId] === m.triggerValue);
}
