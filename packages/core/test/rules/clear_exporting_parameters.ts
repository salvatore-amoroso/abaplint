import {expect} from "chai";
import {ClearExportingParameters, ClearExportingParametersConf} from "../../src/rules";
import {Registry} from "../../src/registry";
import {MemoryFile} from "../../src/files/memory_file";
import {Issue} from "../../src/issue";

async function runFiles(files: MemoryFile[], config?: ClearExportingParametersConf): Promise<Issue[]> {
  const reg = new Registry();
  for (const file of files) {
    reg.addFile(file);
  }
  await reg.parseAsync();
  const rule = new ClearExportingParameters();
  if (config) {
    rule.setConfig(config);
  }
  return rule.initialize(reg).run(reg.getFirstObject()!);
}

async function runSingle(abap: string, config?: ClearExportingParametersConf): Promise<Issue[]> {
  return runFiles([new MemoryFile("zcl_foo.clas.abap", abap)], config);
}

function wrap(body: string, definition = "METHODS foo EXPORTING ev_result TYPE i."): string {
  return `CLASS zcl_foo DEFINITION PUBLIC.
  PUBLIC SECTION.
    ${definition}
ENDCLASS.
CLASS zcl_foo IMPLEMENTATION.
  METHOD foo.
${body}
  ENDMETHOD.
ENDCLASS.`;
}

function wrapFunctionModule(body: string, passByValue = false, globalParameters = false): MemoryFile[] {
  const reference = passByValue ? "" : "<REFERENCE>X</REFERENCE>";
  const globalFlag = globalParameters ? "<GLOBAL_FLAG>X</GLOBAL_FLAG>" : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0">
  <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
    <asx:values>
      <AREAT>test</AREAT>
      <FUNCTIONS>
        <item>
          <FUNCNAME>ZFOO</FUNCNAME>
          ${globalFlag}
          <EXPORT>
            <RSEXP>
              <PARAMETER>EV_RESULT</PARAMETER>
              ${reference}
              <TYP>I</TYP>
            </RSEXP>
          </EXPORT>
        </item>
      </FUNCTIONS>
    </asx:values>
  </asx:abap>
</abapGit>`;
  return [
    new MemoryFile("zfoo.fugr.xml", xml),
    new MemoryFile("zfoo.fugr.saplzfoo.abap", "FUNCTION-POOL zfoo."),
    new MemoryFile("zfoo.fugr.zfoo.abap", `FUNCTION zfoo.
${body}
ENDFUNCTION.`),
  ];
}

describe("Rule: clear_exporting_parameters", () => {

  it("parser error, no issues", async () => {
    const issues = await runSingle("parser error.");
    expect(issues.length).to.equal(0);
  });

  it("read before write (self assignment), issue", async () => {
    const issues = await runSingle(wrap("    ev_result = ev_result + 1."));
    expect(issues.length).to.equal(1);
  });

  it("read in earlier statement, issue", async () => {
    const issues = await runSingle(wrap("    DATA(lv_copy) = ev_result.\n    ev_result = lv_copy + 1."));
    expect(issues.length).to.equal(1);
  });

  for (const test of [
    {name: "SEARCH AND MARK", body: "SEARCH ev_result FOR 'A' AND MARK.",
      definition: "TYPES ty_line TYPE c LENGTH 72. METHODS foo EXPORTING ev_result TYPE ty_line."},
    {name: "editable EDITOR-CALL", body: "EDITOR-CALL FOR ev_result.",
      definition: "TYPES ty_line TYPE c LENGTH 72. TYPES ty_lines TYPE STANDARD TABLE OF ty_line WITH DEFAULT KEY. METHODS foo EXPORTING ev_result TYPE ty_lines."},
    {name: "table-expression method receiver", body: "ev_result[ 1 ]->foo( ).",
      definition: "TYPES ty_objects TYPE STANDARD TABLE OF REF TO zcl_foo WITH DEFAULT KEY. METHODS foo EXPORTING ev_result TYPE ty_objects."},
    {name: "IMPORT through a data reference", body: "DATA text TYPE string. IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ev_result->*.",
      definition: "TYPES ty_line TYPE c LENGTH 72. METHODS foo EXPORTING ev_result TYPE REF TO ty_line."},
    {name: "IMPORT through an object reference", body: "DATA text TYPE string. IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ev_result->codepage.",
      definition: "DATA codepage TYPE c LENGTH 72. METHODS foo EXPORTING ev_result TYPE REF TO zcl_foo."},
    {name: "IMPORT into an existing table row", body: "DATA text TYPE string. IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ev_result[ 1 ].",
      definition: "TYPES ty_line TYPE c LENGTH 72. TYPES ty_lines TYPE STANDARD TABLE OF ty_line WITH DEFAULT KEY. METHODS foo EXPORTING ev_result TYPE ty_lines."},
    {name: "OVERLAY", body: "OVERLAY ev_result WITH 'x'. DATA(got) = ev_result.",
      definition: "TYPES ty_line TYPE c LENGTH 72. METHODS foo EXPORTING ev_result TYPE ty_line."},
    {name: "GET DATASET through a data reference", body: "DATA filename TYPE string. GET DATASET filename POSITION ev_result->*. DATA(got) = ev_result->*.",
      definition: "METHODS foo EXPORTING ev_result TYPE REF TO i."},
    {name: "GET DATASET through an object reference", body: "DATA filename TYPE string. GET DATASET filename POSITION ev_result->position. DATA(got) = ev_result->position.",
      definition: "DATA position TYPE i. METHODS foo EXPORTING ev_result TYPE REF TO zcl_foo."},
    {name: "GET DATASET into an existing table row", body: "DATA filename TYPE string. GET DATASET filename POSITION ev_result[ 1 ]. DATA(got) = ev_result[ 1 ].",
      definition: "TYPES ty_numbers TYPE STANDARD TABLE OF i WITH DEFAULT KEY. METHODS foo EXPORTING ev_result TYPE ty_numbers."},
    {name: "GET DATASET into a structure component", body: "DATA filename TYPE string. GET DATASET filename POSITION ev_result-position. DATA(got) = ev_result-other.",
      definition: "TYPES: BEGIN OF ty_record, position TYPE i, other TYPE i, END OF ty_record. METHODS foo EXPORTING ev_result TYPE ty_record."},
    {name: "IMPORT into a structure component", body: "DATA text TYPE string. IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ev_result-codepage. DATA(got) = ev_result-other.",
      definition: "TYPES: BEGIN OF ty_record, codepage TYPE c LENGTH 4, other TYPE i, END OF ty_record. METHODS foo EXPORTING ev_result TYPE ty_record."},
    {name: "IMPORT into a substring", body: "DATA text TYPE string. IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ev_result+0(4). DATA(got) = ev_result+4(4).",
      definition: "TYPES ty_text TYPE c LENGTH 8. METHODS foo EXPORTING ev_result TYPE ty_text."},
  ]) {
    it(`${test.name} reads the existing exporting parameter`, async () => {
      const issues = await runSingle(wrap(test.body, test.definition));
      expect(issues.map(issue => issue.getMessage()))
        .to.deep.equal(['EXPORTING parameter "ev_result" read before it is cleared or assigned']);
    });
    it(`${test.name} allows an exporting parameter cleared first`, async () => {
      const issues = await runSingle(wrap("CLEAR ev_result. " + test.body, test.definition));
      expect(issues.length).to.equal(0);
    });
  }

  for (const body of ["CLEAR ev_result[].", "ev_result[] = VALUE #( )."]) {
    it(`${body} initializes the whole exporting table`, async () => {
      const definition = "TYPES ty_numbers TYPE STANDARD TABLE OF i WITH DEFAULT KEY. METHODS foo EXPORTING ev_result TYPE ty_numbers.";
      const issues = await runSingle(wrap(body + " DATA(got) = lines( ev_result ).", definition));
      expect(issues.length).to.equal(0);
    });
  }

  for (const test of [
    {target: "&1+0(4)", clear: "", issues: 1},
    {target: "&1+0(4)", clear: "CLEAR ev_result.", issues: 0},
    {target: "&1", clear: "", issues: 0},
  ]) {
    it(`macro output ${test.target} after ${test.clear || "no initialization"}`, async () => {
      const macro = `DEFINE output_value.
  IMPORT text FROM MEMORY ID 'x' CODE PAGE INTO ${test.target}.
END-OF-DEFINITION.
`;
      const definition = "TYPES ty_text TYPE c LENGTH 8. METHODS foo EXPORTING ev_result TYPE ty_text.";
      const body = `DATA text TYPE string. ${test.clear} output_value ev_result. DATA(got) = ev_result+4(4).`;
      const source = macro + wrap(body, definition).replace("DEFINITION PUBLIC.", "DEFINITION.");
      const issues = await runFiles([new MemoryFile("zmacro.prog.abap", source)]);
      expect(issues.length).to.equal(test.issues);
    });
  }

  it("CLEAR before read, no issue", async () => {
    const issues = await runSingle(wrap("    CLEAR ev_result.\n    ev_result = ev_result + 1."));
    expect(issues.length).to.equal(0);
  });

  it("write before read, no issue", async () => {
    const issues = await runSingle(wrap("    ev_result = 1.\n    ev_result = ev_result + 1."));
    expect(issues.length).to.equal(0);
  });

  it("IS SUPPLIED check, no issue", async () => {
    const issues = await runSingle(wrap("    IF ev_result IS SUPPLIED.\n      ev_result = 1.\n    ENDIF."));
    expect(issues.length).to.equal(0);
  });

  it("IS REQUESTED check, no issue", async () => {
    const issues = await runSingle(wrap("    IF ev_result IS REQUESTED.\n      ev_result = 1.\n    ENDIF."));
    expect(issues.length).to.equal(0);
  });

  it("GET REFERENCE OF, no issue", async () => {
    const issues = await runSingle(wrap("    GET REFERENCE OF ev_result INTO DATA(lr_ref).\n    lr_ref->* = 1."));
    expect(issues.length).to.equal(0);
  });

  it("ASSIGN to field symbol, no issue", async () => {
    const issues = await runSingle(wrap("    ASSIGN ev_result TO FIELD-SYMBOL(<lv_val>).\n    <lv_val> = 1."));
    expect(issues.length).to.equal(0);
  });

  it("read before GET REFERENCE OF, issue", async () => {
    const issues = await runSingle(wrap("    DATA(lv_copy) = ev_result.\n    GET REFERENCE OF ev_result INTO DATA(lr_ref).\n    lr_ref->* = lv_copy."));
    expect(issues.length).to.equal(1);
  });

  it("IS NOT SUPPLIED check, no issue", async () => {
    const issues = await runSingle(wrap("    IF ev_result IS NOT SUPPLIED.\n      RETURN.\n    ENDIF.\n    ev_result = 1."));
    expect(issues.length).to.equal(0);
  });

  it("IS SUPPLIED but read afterwards, issue", async () => {
    const issues = await runSingle(wrap("    IF ev_result IS SUPPLIED.\n    ENDIF.\n    ev_result = ev_result + 1."));
    expect(issues.length).to.equal(1);
  });

  it("plain assignment only, no issue", async () => {
    const issues = await runSingle(wrap("    ev_result = 1."));
    expect(issues.length).to.equal(0);
  });

  it("cast assignment before read, no issue", async () => {
    const def = `DATA mo_insert TYPE REF TO object.
    METHODS foo EXPORTING eo_insert TYPE REF TO object.`;
    const body = `    eo_insert ?= mo_insert.
    ASSERT eo_insert IS BOUND.`;
    const issues = await runSingle(wrap(body, def));
    expect(issues.length).to.equal(0);
  });

  it("statement lookup considers the include filename", async () => {
    const testclasses = `CLASS ltcl_test DEFINITION FOR TESTING.
  PRIVATE SECTION.
    METHODS test FOR TESTING.
ENDCLASS.
CLASS ltcl_test IMPLEMENTATION.
  METHOD test.

    DATA(lv_value) =
      1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9.
  ENDMETHOD.
ENDCLASS.`;
    const main = wrap(`    eo_insert ?= mo_insert.
    ASSERT eo_insert IS BOUND.`, `DATA mo_insert TYPE REF TO object.
    METHODS foo EXPORTING eo_insert TYPE REF TO object.`);
    const issues = await runFiles([
      new MemoryFile("zcl_foo.clas.testclasses.abap", testclasses),
      new MemoryFile("zcl_foo.clas.abap", main),
    ]);
    expect(issues.length).to.equal(0);
  });

  it("never touched, no issue (handled by unused_variables)", async () => {
    const issues = await runSingle(wrap("    RETURN."));
    expect(issues.length).to.equal(0);
  });

  it("pass by value, no issue", async () => {
    const def = "METHODS foo EXPORTING VALUE(ev_result) TYPE i.";
    const issues = await runSingle(wrap("    ev_result = ev_result + 1.", def));
    expect(issues.length).to.equal(0);
  });

  it("pass by value declared in interface, no issue", async () => {
    const intf = `INTERFACE zif_foo PUBLIC.
  METHODS foo EXPORTING VALUE(ev_result) TYPE i.
ENDINTERFACE.`;
    const clas = `CLASS zcl_foo DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_foo.
ENDCLASS.
CLASS zcl_foo IMPLEMENTATION.
  METHOD zif_foo~foo.
    ev_result = ev_result + 1.
  ENDMETHOD.
ENDCLASS.`;
    const reg = new Registry().addFiles([
      new MemoryFile("zif_foo.intf.abap", intf),
      new MemoryFile("zcl_foo.clas.abap", clas),
    ]);
    await reg.parseAsync();

    const rule = new ClearExportingParameters().initialize(reg);
    const issues = rule.run(reg.getObject("CLAS", "ZCL_FOO")!);
    expect(issues.length).to.equal(0);
  });

  it("function module exporting parameter read before write, issue", async () => {
    const issues = await runFiles(wrapFunctionModule("  ev_result = ev_result + 1."));
    expect(issues.length).to.equal(1);
  });

  it("function module exporting parameter cleared before read, no issue", async () => {
    const issues = await runFiles(wrapFunctionModule(`  CLEAR ev_result.
  ev_result = ev_result + 1.`));
    expect(issues.length).to.equal(0);
  });

  it("function module exporting parameter passed by value, no issue", async () => {
    const issues = await runFiles(wrapFunctionModule("  ev_result = ev_result + 1.", true));
    expect(issues.length).to.equal(0);
  });

  it("function module global exporting parameter read before write, issue", async () => {
    const issues = await runFiles(wrapFunctionModule("  ev_result = ev_result + 1.", false, true));
    expect(issues.length).to.equal(1);
  });

  it("importing parameter, no issue", async () => {
    const def = "METHODS foo IMPORTING iv_input TYPE i EXPORTING ev_result TYPE i.";
    const issues = await runSingle(wrap("    ev_result = iv_input.", def));
    expect(issues.length).to.equal(0);
  });

  it("changing parameter, no issue", async () => {
    const def = "METHODS foo CHANGING cv_value TYPE i.";
    const issues = await runSingle(wrap("    cv_value = cv_value + 1.", def));
    expect(issues.length).to.equal(0);
  });

  it("skipNames config, no issue", async () => {
    const config = new ClearExportingParametersConf();
    config.skipNames = ["ev_result"];
    const issues = await runSingle(wrap("    ev_result = ev_result + 1."), config);
    expect(issues.length).to.equal(0);
  });

  it("read in nested control structure, issue", async () => {
    const body = `    IF 1 = 1.
      ev_result = ev_result + 1.
    ENDIF.`;
    const issues = await runSingle(wrap(body));
    expect(issues.length).to.equal(1);
  });

  it("cleared inside method, table appended, no issue", async () => {
    const def = `TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    METHODS foo EXPORTING et_tab TYPE ty_tab.`;
    const body = `    CLEAR et_tab.
    APPEND 1 TO et_tab.`;
    const issues = await runSingle(wrap(body, def));
    expect(issues.length).to.equal(0);
  });

  it("read via WRITE before assigned, issue", async () => {
    const issues = await runSingle(wrap("    WRITE ev_result.\n    ev_result = 1."));
    expect(issues.length).to.equal(1);
  });

});
