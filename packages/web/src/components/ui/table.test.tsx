import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

describe("Table", () => {
  it("renders semantic table with header, body, and rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>id</TableHead>
            <TableHead>name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>1</TableCell>
            <TableCell>ada</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>2</TableCell>
            <TableCell>grace</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveAttribute("data-slot", "table");

    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders).toHaveLength(2);
    expect(columnHeaders[0]).toHaveTextContent(/id/i);
    expect(columnHeaders[1]).toHaveTextContent(/name/i);

    const rows = within(table).getAllByRole("row");
    // 1 header row + 2 body rows = 3
    expect(rows).toHaveLength(3);

    const bodyCells = screen.getAllByRole("cell");
    expect(bodyCells).toHaveLength(4);
    expect(bodyCells.map((c) => c.textContent)).toEqual(["1", "ada", "2", "grace"]);
  });
});
