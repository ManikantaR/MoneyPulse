"""Synthetic PDF test fixtures for parser tests.

Uses fpdf2 to programmatically generate PDF files with known content,
avoiding dependency on real bank statements for testing.
"""

from fpdf import FPDF


def create_simple_pdf(text: str) -> bytes:
    """Create a minimal single-page PDF with the given text content.

    Args:
        text: Plain text to render on the page.

    Returns:
        PDF file content as bytes.
    """
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)
    for line in text.split("\n"):
        pdf.cell(0, 8, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def create_boa_statement_pdf() -> bytes:
    """Create a synthetic Bank of America statement PDF with sample transactions.

    The generated PDF mimics real BofA statement layout:
    - Header identifying Bank of America
    - Deposits section with credit transactions
    - Withdrawals section with debit transactions
    - Transaction lines follow: MM/DD/YY  Description  Amount  Balance

    Returns:
        PDF file content as bytes.
    """
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)

    # Header
    pdf.cell(0, 8, "Bank of America", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "Statement Period: 03/01/26 - 03/31/26", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "Account Number: ****1234", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "", new_x="LMARGIN", new_y="NEXT")

    # Deposits section
    pdf.cell(0, 8, "Deposits and other additions", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "03/01/26  PAYROLL DIRECT DEPOSIT  3,200.00  5,432.10", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "03/15/26  VENMO TRANSFER  150.00  4,892.33", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "", new_x="LMARGIN", new_y="NEXT")

    # Withdrawals section
    pdf.cell(0, 8, "Withdrawals and other subtractions", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "03/05/26  WHOLE FOODS MARKET #10234  85.23  5,346.87", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "03/10/26  SHELL OIL 57442  42.50  5,304.37", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "03/12/26  AMAZON.COM*M44KL2  29.99  5,274.38", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "", new_x="LMARGIN", new_y="NEXT")

    # Footer
    pdf.cell(0, 8, "Daily ending balance", new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


def create_tabular_pdf() -> bytes:
    """Create a PDF with a table-like layout for generic parser testing.

    Uses simple column-aligned text to simulate a bank statement table
    with Date, Description, and Amount columns.

    Returns:
        PDF file content as bytes.
    """
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)

    # Table header
    col_widths = [30, 100, 40]
    headers = ["Date", "Description", "Amount"]
    for i, header in enumerate(headers):
        pdf.cell(col_widths[i], 8, header, border=1)
    pdf.ln()

    # Table rows
    rows = [
        ("03/15/2026", "WHOLE FOODS MARKET", "-85.23"),
        ("03/16/2026", "PAYROLL DEPOSIT", "3,200.00"),
        ("03/17/2026", "STARBUCKS COFFEE", "-5.75"),
        ("03/18/2026", "AMAZON.COM", "-29.99"),
    ]
    for row in rows:
        for i, cell_val in enumerate(row):
            pdf.cell(col_widths[i], 8, cell_val, border=1)
        pdf.ln()

    return bytes(pdf.output())
