import * as Expressions from "../../2_statements/expressions";
import {StatementNode} from "../../nodes";
import {Source} from "../expressions/source";
import {StatementSyntax} from "../_statement_syntax";
import {SyntaxInput} from "../_syntax_input";

export class Search implements StatementSyntax {
  public runSyntax(node: StatementNode, input: SyntaxInput): void {

    const target = node.findDirectTokenByText("MARK") ? node.findDirectExpression(Expressions.Source) : undefined;
    for (const s of node.findDirectExpressions(Expressions.Source)) {
      const write = s === target;
      Source.runSyntax(s, input, undefined, write, false, true, write);
    }

  }
}
