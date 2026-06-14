from pathlib import Path
import argparse
import json
from datetime import date, datetime

import numpy as np
import pandas as pd


# -------------------------------------------------------
# DEFAULT OUTPUT FILE NAMES
# -------------------------------------------------------

DEFAULT_DOMESTIC_OUTPUT_NAME = "entsoe_domestic_generation_2019_2025.json"
DEFAULT_FLOWS_OUTPUT_NAME = "entsoe_power_flows_2019_2025.json"


# -------------------------------------------------------
# FILE CLASSIFICATION KEYWORDS
# -------------------------------------------------------

DOMESTIC_KEYWORDS = [
    "domestic",
    "generation",
    "monthly_domestic",
    "domestic_generation",
    "entsoe_domestic_generation"
]

FLOW_KEYWORDS = [
    "flow",
    "flows",
    "power_flow",
    "power_flows",
    "physical_energy",
    "physical_energy_power_flows",
    "entsoe_power_flows"
]


# -------------------------------------------------------
# COMMAND LINE ARGUMENTS
# -------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Convert cleaned ENTSO-E Excel files into two combined JSON files: "
            "one for domestic generation and one for physical power flows."
        )
    )

    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=Path("input_xlsx"),
        help="Folder containing the cleaned .xlsx files. Default: input_xlsx"
    )

    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("output_json"),
        help="Folder where the JSON files will be saved. Default: output_json"
    )

    parser.add_argument(
        "--domestic-output-name",
        type=str,
        default=DEFAULT_DOMESTIC_OUTPUT_NAME,
        help=f"Output filename for domestic generation JSON. Default: {DEFAULT_DOMESTIC_OUTPUT_NAME}"
    )

    parser.add_argument(
        "--flows-output-name",
        type=str,
        default=DEFAULT_FLOWS_OUTPUT_NAME,
        help=f"Output filename for power flows JSON. Default: {DEFAULT_FLOWS_OUTPUT_NAME}"
    )

    parser.add_argument(
        "--include-source-metadata",
        action="store_true",
        help="Add source_file and source_sheet fields to every JSON record."
    )

    return parser.parse_args()


# -------------------------------------------------------
# FILE CLASSIFICATION
# -------------------------------------------------------

def classify_file(xlsx_path: Path):
    """
    Classify an Excel file as either:
    - domestic
    - flows
    - unknown

    The classification is based on the file name.
    """

    name = xlsx_path.stem.lower()

    has_domestic_keyword = any(keyword in name for keyword in DOMESTIC_KEYWORDS)
    has_flow_keyword = any(keyword in name for keyword in FLOW_KEYWORDS)

    if has_domestic_keyword and not has_flow_keyword:
        return "domestic"

    if has_flow_keyword and not has_domestic_keyword:
        return "flows"

    return "unknown"


# -------------------------------------------------------
# VALUE CLEANING
# -------------------------------------------------------

def normalize_value(value):
    """
    Convert Excel / pandas / numpy values into JSON-safe Python values.

    Important:
    - NaN becomes None
    - NaT becomes None
    - pd.NA becomes None
    - inf and -inf become None
    - None becomes JSON null
    """

    if value is None:
        return None

    # pandas missing values: NaN, NaT, pd.NA
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    # Python / numpy floats
    if isinstance(value, (float, np.floating)):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value)

    # Python / numpy ints
    if isinstance(value, (int, np.integer)):
        return int(value)

    # Dates
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()

    # Numpy scalar fallback
    if isinstance(value, np.generic):
        converted = value.item()
        return normalize_value(converted)

    return value


def sanitize_json_value(value):
    """
    Final recursive safety pass before writing JSON.

    This removes NaN, NaT, pd.NA, inf and -inf from:
    - single values
    - dictionaries
    - lists

    This is important because pandas can sometimes convert None back to NaN
    in numeric columns before records are created.
    """

    if value is None:
        return None

    if isinstance(value, dict):
        return {
            key: sanitize_json_value(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            sanitize_json_value(item)
            for item in value
        ]

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, (float, np.floating)):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value)

    if isinstance(value, (int, np.integer)):
        return int(value)

    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()

    if isinstance(value, np.generic):
        return sanitize_json_value(value.item())

    return value


# -------------------------------------------------------
# DATAFRAME CONVERSION
# -------------------------------------------------------

def clean_dataframe(df: pd.DataFrame):
    """
    Prepare a DataFrame for JSON export.
    """

    df = df.copy()

    # Clean column names
    df.columns = [str(column).strip() for column in df.columns]

    # Remove completely empty rows
    df = df.dropna(how="all")

    # Replace infinite values with NaN first;
    # they are later converted to None / null.
    df = df.replace([np.inf, -np.inf], np.nan)

    return df


def dataframe_to_records(
    df: pd.DataFrame,
    include_source_metadata: bool,
    source_file: str | None = None,
    source_sheet: str | None = None
):
    """
    Convert a cleaned DataFrame into JSON-safe records.
    """

    df = clean_dataframe(df)

    for column in df.columns:
        df[column] = df[column].map(normalize_value)

    records = df.to_dict(orient="records")

    # Important final pass:
    # pandas can sometimes turn None back into NaN in numeric columns.
    records = sanitize_json_value(records)

    if include_source_metadata:
        for record in records:
            record["source_file"] = source_file
            record["source_sheet"] = source_sheet

    return records


def read_excel_file(xlsx_path: Path, include_source_metadata: bool):
    """
    Read all sheets from one Excel file and return JSON-safe records.
    """

    all_records = []

    excel_file = pd.ExcelFile(xlsx_path)

    for sheet_name in excel_file.sheet_names:
        df = pd.read_excel(xlsx_path, sheet_name=sheet_name, header=0)

        if df.empty:
            continue

        records = dataframe_to_records(
            df=df,
            include_source_metadata=include_source_metadata,
            source_file=xlsx_path.stem,
            source_sheet=sheet_name
        )

        all_records.extend(records)

    return all_records


# -------------------------------------------------------
# JSON EXPORT
# -------------------------------------------------------

def write_json(records, output_file: Path):
    """
    Write records to JSON.

    The final sanitize step makes sure that no NaN, inf or -inf values remain.
    allow_nan=False prevents invalid JSON from being written.
    """

    safe_records = sanitize_json_value(records)

    with open(output_file, "w", encoding="utf-8") as file:
        json.dump(
            safe_records,
            file,
            ensure_ascii=False,
            indent=2,
            allow_nan=False
        )


# -------------------------------------------------------
# MAIN CONVERSION
# -------------------------------------------------------

def convert_entsoe_excels(
    input_dir: Path,
    output_dir: Path,
    domestic_output_name: str,
    flows_output_name: str,
    include_source_metadata: bool
):
    """
    Convert all .xlsx files from the input folder into two combined JSON files:
    - one domestic generation file
    - one power flows file
    """

    input_dir = input_dir.resolve()
    output_dir = output_dir.resolve()

    output_dir.mkdir(parents=True, exist_ok=True)

    xlsx_files = sorted(input_dir.glob("*.xlsx"))

    if not xlsx_files:
        print(f"No .xlsx files found in: {input_dir}")
        return

    domestic_records = []
    flow_records = []
    unknown_files = []
    failed_files = []

    print(f"Input folder:  {input_dir}")
    print(f"Output folder: {output_dir}")
    print(f"Found {len(xlsx_files)} .xlsx file(s).\n")

    for xlsx_path in xlsx_files:
        file_type = classify_file(xlsx_path)

        if file_type == "unknown":
            unknown_files.append(xlsx_path.name)
            print(f"Skipped unknown file type: {xlsx_path.name}")
            continue

        try:
            records = read_excel_file(
                xlsx_path=xlsx_path,
                include_source_metadata=include_source_metadata
            )

            if file_type == "domestic":
                domestic_records.extend(records)
                print(
                    f"Added to domestic generation: {xlsx_path.name} "
                    f"({len(records)} rows)"
                )

            elif file_type == "flows":
                flow_records.extend(records)
                print(
                    f"Added to power flows:         {xlsx_path.name} "
                    f"({len(records)} rows)"
                )

        except Exception as error:
            failed_files.append((xlsx_path.name, str(error)))
            print(f"Failed to process {xlsx_path.name}: {error}")

    domestic_output_file = output_dir / domestic_output_name
    flows_output_file = output_dir / flows_output_name

    write_json(domestic_records, domestic_output_file)
    write_json(flow_records, flows_output_file)

    print("\nConversion finished.")
    print("--------------------------------")
    print(f"Domestic generation output: {domestic_output_file}")
    print(f"Domestic generation rows:   {len(domestic_records)}")
    print()
    print(f"Power flows output:         {flows_output_file}")
    print(f"Power flows rows:           {len(flow_records)}")

    if unknown_files:
        print("\nSkipped files with unknown type:")
        for filename in unknown_files:
            print(f"- {filename}")

    if failed_files:
        print("\nFiles with errors:")
        for filename, error in failed_files:
            print(f"- {filename}: {error}")


def main():
    args = parse_args()

    convert_entsoe_excels(
        input_dir=args.input,
        output_dir=args.output,
        domestic_output_name=args.domestic_output_name,
        flows_output_name=args.flows_output_name,
        include_source_metadata=args.include_source_metadata
    )


if __name__ == "__main__":
    main()