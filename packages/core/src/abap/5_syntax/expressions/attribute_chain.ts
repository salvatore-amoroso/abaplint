import {ExpressionNode} from "../../nodes";
import {INode} from "../../nodes/_inode";
import * as Expressions from "../../2_statements/expressions";
import {AbstractType} from "../../types/basic/_abstract_type";
import {VoidType} from "../../types/basic/void_type";
import {DataReference, ObjectReferenceType, StructureType, TableType, UnknownType} from "../../types/basic";
import {ReferenceType} from "../_reference";
import {AttributeName} from "../../2_statements/expressions";
import {CheckSyntaxKey, SyntaxInput, syntaxIssue} from "../_syntax_input";
import {ComponentName} from "./component_name";
import {AttributeName as AttributeNameSyntax} from "./attribute_name";
import {TableExpression} from "./table_expression";
import {FieldOffset} from "./field_offset";
import {FieldLength} from "./field_length";
import {substringType} from "./_substring";
import {targetReference} from "./_target_reference";

export class AttributeChain {
  public static runSyntax(
    inputContext: AbstractType | undefined,
    node: INode,
    input: SyntaxInput,
    type: ReferenceType[],
    dereferenced = false,
    writeTarget = false): AbstractType | undefined {

    if (inputContext instanceof VoidType) {
      return inputContext;
    } else if (!(inputContext instanceof ObjectReferenceType)) {
      input.issues.push(syntaxIssue(input, node.getFirstToken(), "Not an object reference(AttributeChain)"));
      return VoidType.get(CheckSyntaxKey);
    }

    const first = node.getChildren()[0];
    if (!(first.get() instanceof AttributeName)) {
      input.issues.push(syntaxIssue(input, node.getFirstToken(), "AttributeChain, unexpected first child"));
      return VoidType.get(CheckSyntaxKey);
    }

    const children = node.getChildren();
    // Binding an alias records potential writes without modifying the attribute.
    const writing = writeTarget || (type.includes(ReferenceType.DataWriteReference)
      && type.includes(ReferenceType.DataReadReference) === false);
    const firstTarget = writing ? targetReference(children, 1, dereferenced) : undefined;
    const firstType = firstTarget === ReferenceType.DataWriteReference && writeTarget ? type : firstTarget ?? type;
    let contextType = AttributeNameSyntax.runSyntax(
      inputContext, first, input, firstType, true, firstTarget === ReferenceType.DataWriteReference);
    for (let i = 1; i < children.length; i++) {
      const child = children[i];

      if (contextType instanceof VoidType || contextType instanceof UnknownType) {
        return contextType;
      } else if (child.get() instanceof Expressions.ArrowOrDash) {
        const operator = child.getFirstToken().getStr();
        if (operator === "-" && !(contextType instanceof StructureType)) {
          input.issues.push(syntaxIssue(input, child.getFirstToken(), "AttributeChain, not a structure"));
          return VoidType.get(CheckSyntaxKey);
        } else if ((operator === "->" || operator === "=>")
            && !(contextType instanceof ObjectReferenceType)
            && !(contextType instanceof DataReference)) {
          input.issues.push(syntaxIssue(input, child.getFirstToken(), "AttributeChain, not a reference"));
          return VoidType.get(CheckSyntaxKey);
        }
      } else if (child.get() instanceof Expressions.ComponentName) {
        if (contextType instanceof ObjectReferenceType || contextType instanceof DataReference) {
          const target = writing ? targetReference(children, i + 1, dereferenced) : undefined;
          const refType = target === ReferenceType.DataWriteReference && writeTarget ? type : target ?? type;
          contextType = AttributeNameSyntax.runSyntax(
            contextType, child, input, refType, true, target === ReferenceType.DataWriteReference);
        } else {
          contextType = ComponentName.runSyntax(contextType, child, input);
        }
      } else if (child.getFirstToken().getStr() === "*" && contextType instanceof DataReference) {
        contextType = contextType.getType();
      } else if (child instanceof ExpressionNode && child.get() instanceof Expressions.TableExpression) {
        if (!(contextType instanceof TableType)) {
          input.issues.push(syntaxIssue(input, child.getFirstToken(), "Table expression, expected table"));
          return VoidType.get(CheckSyntaxKey);
        }
        TableExpression.runSyntax(child, input, contextType);
        contextType = contextType.getRowType();
      } else if (child instanceof ExpressionNode && child.get() instanceof Expressions.FieldOffset) {
        const offset = FieldOffset.runSyntax(child, input);
        contextType = substringType(contextType, offset, undefined, child, input);
      } else if (child instanceof ExpressionNode && child.get() instanceof Expressions.FieldLength) {
        const length = FieldLength.runSyntax(child, input);
        contextType = substringType(contextType, undefined, length, child, input);
      }
    }

    return contextType;
  }

}
