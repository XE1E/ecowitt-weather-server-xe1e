from app.services.csv_export import rows_to_csv, safe_filename_part


def test_empty_rows_returns_empty_string():
    assert rows_to_csv([]) == ""


def test_time_column_leads_and_header_present():
    rows = [{"_time": "2026-01-01T00:00:00Z", "temperature_outdoor": 20.5, "humidity_outdoor": 60}]
    out = rows_to_csv(rows)
    lines = out.strip().splitlines()
    assert lines[0] == "_time,humidity_outdoor,temperature_outdoor"
    assert lines[1] == "2026-01-01T00:00:00Z,60,20.5"


def test_union_of_columns_fills_missing_with_empty_string():
    """Un sensor caído en una fila no debe tumbar la exportación ni desalinear columnas."""
    rows = [
        {"_time": "t1", "temperature_outdoor": 20.0, "wind_speed": 5.0},
        {"_time": "t2", "temperature_outdoor": 21.0},  # wind_speed ausente esta fila
    ]
    out = rows_to_csv(rows)
    lines = out.strip().splitlines()
    assert lines[0] == "_time,temperature_outdoor,wind_speed"
    assert lines[1] == "t1,20.0,5.0"
    assert lines[2] == "t2,21.0,"


def test_date_leads_when_no_underscore_time():
    rows = [{"date": "2026-01-01", "rain_total": 3.2}]
    out = rows_to_csv(rows)
    assert out.strip().splitlines()[0] == "date,rain_total"


def test_safe_filename_part_strips_unsafe_chars():
    assert safe_filename_part("2024-01-01T00:00:00Z") == "2024-01-01T00_00_00Z"
    assert safe_filename_part("-7d") == "7d"
    assert safe_filename_part("gw1100") == "gw1100"
    assert safe_filename_part("") == "datos"
    assert safe_filename_part("///") == "datos"
