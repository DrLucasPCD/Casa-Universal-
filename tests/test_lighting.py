import unittest
from casa.controller import DeviceError
from casa.lighting import light_values,readings
from casa.telemetry import tuya

class LightingTests(unittest.TestCase):
    def test_color_change_and_exact_fractional_restore_preserve_power(self):
        original='006700000282'
        mode,signal=light_values(original,{'color':'#ff0000','brightness':50})
        self.assertEqual((mode,signal),('colour','000003e801f4'))
        self.assertEqual(light_values(signal,{'hue':103,'saturation':0,'brightness':64.2})[1],original)
        self.assertEqual(readings(original)['brightness_percent'],64.2)
        self.assertNotIn('power',readings(original))
        self.assertEqual(light_values(original,{'color':'#000000'})[1][-4:],'0000')

    def test_invalid_adjustments_rejected(self):
        for values in ({'brightness':True},{'brightness':float('nan')},{'brightness':101},{'color':'red'},{'color':'#ff0000','hue':0},{'hue':-1},{'mode':'white'},{}):
            with self.subTest(values=values),self.assertRaises(DeviceError):light_values('006700000282',values)
        self.assertEqual(readings('ffffffffffff'),{})

    def test_curtain_inversion_uses_only_measured_dp(self):
        self.assertEqual(tuya({'dps':{'2':21}},{'position_dp':2,'position_inverted':True})['position_percent'],79)
        self.assertEqual(tuya({'dps':{'1':'close'}},{'position_dp':2}),{})
        self.assertEqual(tuya({'dps':{'2':True}},{'position_dp':2}),{})
