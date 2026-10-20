import * as Expressions from "../../2_statements/expressions";
import {StatementNode} from "../../nodes";
import {Source} from "../expressions/source";
import {Target} from "../expressions/target";
import {Dynamic} from "../expressions/dynamic";
import {StatementSyntax} from "../_statement_syntax";
import {SyntaxInput} from "../_syntax_input";

export class CallDatabase implements StatementSyntax {
  public runSyntax(node: StatementNode, input: SyntaxInput): void {
    for (const expression of node.findAllExpressionsMulti([Expressions.Source, Expressions.Target, Expressions.Dynamic])) {
      if (expression.get() instanceof Expressions.Target) {
        Target.runSyntax(expression, input);
      } else if (expression.get() instanceof Expressions.Dynamic) {
        Dynamic.runSyntax(expression, input);
      } else {
        Source.runSyntax(expression, input);
      }
    }
  }
}
