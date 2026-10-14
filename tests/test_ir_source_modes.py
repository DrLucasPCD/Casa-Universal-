import json
from pathlib import Path
import unittest
from scripts.build_ir_catalog import extract_commands
from casa.generic_remote import TEMPLATES

class SourceModesTests(unittest.TestCase):
    def test_philco_declared_heat_signals_are_recovered_from_original_source(self):
        source=Path(__file__).resolve().parents[1]/'research/ir-source/codes/climate/3000.json'
        if not source.exists():self.skipTest('Optional licensed source checkout not installed')
        raw=json.loads(source.read_text());commands=extract_commands(raw)
        self.assertEqual(commands['heat_auto_stop_24'],raw['heat']['Auto']['Stop']['24'])
        self.assertEqual(len(commands),409)
        raw['operationModes']=[]
        self.assertNotIn('heat_auto_stop_24',extract_commands(raw))
    def test_every_remote_class_has_configurable_slots_without_codes(self):
        for type_ in ('tv','climate','projector','fan','audio','light','cover','switch','other'):
            template=TEMPLATES[type_];self.assertTrue(template['buttons'])
            self.assertEqual(len({b['id'] for b in template['buttons']}),len(template['buttons']))
            self.assertFalse(any('code' in b for b in template['buttons']))

if __name__=='__main__':unittest.main()
