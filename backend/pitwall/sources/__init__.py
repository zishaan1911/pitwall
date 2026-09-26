"""Adapters for the upstream data sources.

FastF1 (official timing feed) is required. OpenF1, Jolpica and Open-Meteo add
detail; if one of them is down, the bundle is still built and its `sources`
block records what was missing.
"""
